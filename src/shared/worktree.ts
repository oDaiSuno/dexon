import { existsSync, mkdirSync, realpathSync } from "fs";
import { basename, dirname, join, resolve } from "path";
import { allowFileRoot } from "./allowed-roots.ts";
import type { GitBranchResult, GitHeadContentResult, GitStatusResult } from "./api-types";
import { git, gitRaw } from "./git-command.ts";
import { parseAheadBehind, parseGitStatusPorcelain } from "./git-status.ts";
import { parseWorktreeList } from "./worktree-list.ts";
import { worktreePathsEqual } from "./worktree-path.ts";
export { parseGitStatusPorcelain } from "./git-status.ts";
export { setGitCommandRunner } from "./git-command.ts";
export type { GitCommandRunner, GitCommandRunOptions } from "./git-command.ts";
export { normalizeWorktreePathForComparison, worktreePathsEqual } from "./worktree-path.ts";
export { parseWorktreeList, type ParsedWorktree } from "./worktree-list.ts";

// ============================================================================
// Project resolution: cwd → { projectRoot, branch }
//
// A worktree's `git rev-parse --git-common-dir` points at the *main* repo's
// .git directory, so its parent is the project root shared by all worktrees.
// Non-git directories resolve to themselves. Results use a process-local short
// TTL cache; add/remove worktree invalidates it eagerly.
// ============================================================================

export interface ProjectInfo {
  projectRoot: string;
  /** Current branch of the cwd, null for non-git dirs or detached HEAD */
  branch: string | null;
  /** True when cwd is a linked worktree (not the main checkout) */
  isWorktree: boolean;
  /** True when cwd is the top-level directory of a checkout (main or linked).
   *  False for repo subdirectories and non-git dirs — the worktree switcher
   *  is only meaningful at the top level. */
  isTopLevel: boolean;
}

export interface WorktreeInfo {
  path: string;
  branch: string | null;
  isMain: boolean;
}

const PROJECT_CACHE_TTL_MS = 60_000;
const projectCache = new Map<string, { info: ProjectInfo; expiresAt: number }>();
const inferredProjectCache = new Map<string, { root: string | null; expiresAt: number }>();
const pendingInferredProjects = new Map<string, Promise<string | null>>();
let projectCacheRevision = 0;

function getProjectCache(): Map<string, { info: ProjectInfo; expiresAt: number }> {
  return projectCache;
}

export function invalidateProjectCache(): void {
  projectCache.clear();
  inferredProjectCache.clear();
  pendingInferredProjects.clear();
  projectCacheRevision += 1;
}

export function getProjectCacheRevision(): number {
  return projectCacheRevision;
}

/** List repository files through the configured Git runtime. */
export async function listGitFiles(cwd: string): Promise<string[]> {
  const stdout = await gitRaw(cwd, ["ls-files", "--cached", "--others", "--exclude-standard"]);
  return stdout
    .split("\n")
    .map((line) => line.trim().replace(/\\/g, "/"))
    .filter(Boolean);
}

export async function getGitStatus(cwd: string): Promise<GitStatusResult> {
  try {
    const branch = await getGitBranch(cwd);
    if (!branch.isGit) return notGitStatus();
    const [status, aheadBehind] = await Promise.all([
      gitRaw(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=normal"]),
      git(cwd, ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]).catch(() => ""),
    ]);
    return parseGitStatusPorcelain(status, branch.branch, parseAheadBehind(aheadBehind));
  } catch {
    return notGitStatus();
  }
}

function notGitStatus(): GitStatusResult {
  return {
    isGit: false,
    branch: null,
    clean: true,
    staged: 0,
    modified: 0,
    untracked: 0,
    conflicted: 0,
    entries: [],
    upstream: null,
  };
}

export async function getGitBranch(cwd: string): Promise<GitBranchResult> {
  try {
    const raw = await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
    return { isGit: true, branch: raw && raw !== "HEAD" ? raw : null };
  } catch {
    return { isGit: false, branch: null };
  }
}

export async function getGitHeadContent(filePath: string): Promise<GitHeadContentResult> {
  try {
    const dir = dirname(filePath);
    const name = basename(filePath);
    const ignored = await git(dir, ["check-ignore", "-q", "--", name]).then(
      () => true,
      () => false,
    );
    if (ignored) return { comparable: false, content: "" };
    const insideWorkTree = await git(dir, ["rev-parse", "--is-inside-work-tree"]).then(
      () => true,
      () => false,
    );
    if (!insideWorkTree) return { comparable: false, content: "" };
    const content = await gitRaw(dir, ["cat-file", "--filters", `HEAD:./${name}`]).catch(() => "");
    return { comparable: true, content };
  } catch {
    return { comparable: false, content: "" };
  }
}

export function isDirtyWorktreeError(error: unknown): boolean {
  const message = extractGitError(error);
  return /contains modified or untracked files|working tree.*(dirty|modified)|use --force/i.test(message);
}

/**
 * addWorktree() places worktrees in `<repoRoot>-worktrees/<dir>`. When such a
 * directory no longer exists (worktree removed), group its sessions back
 * under the main repo instead of letting them dangle as a phantom project.
 * The dir name is the sanitized branch name — close enough for display.
 */
function inferRemovedWorktree(cwd: string): ProjectInfo | null {
  const parent = dirname(cwd);
  if (!parent.endsWith("-worktrees")) return null;
  const repoRoot = parent.slice(0, -"-worktrees".length);
  if (!repoRoot || !existsSync(join(repoRoot, ".git"))) return null;
  return { projectRoot: repoRoot, branch: basename(cwd), isWorktree: true, isTopLevel: true };
}

export async function resolveProject(cwd: string): Promise<ProjectInfo> {
  const cache = getProjectCache();
  const cached = cache.get(cwd);
  if (cached && cached.expiresAt > Date.now()) return cached.info;

  let info: ProjectInfo;
  let cacheable = true;
  try {
    if (!existsSync(cwd)) {
      info = inferRemovedWorktree(cwd) ?? { projectRoot: cwd, branch: null, isWorktree: false, isTopLevel: false };
      cache.set(cwd, { info, expiresAt: Date.now() + PROJECT_CACHE_TTL_MS });
      return info;
    }
    const out = await git(cwd, [
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
      "--git-dir",
      "--show-toplevel",
      "--abbrev-ref",
      "HEAD",
    ]);
    const [commonDir, gitDir, toplevel, ref] = out.split("\n").map((l) => l.trim());
    // git prints resolved (symlink-free) paths; normalize cwd the same way
    const realCwds = [cwd];
    for (const resolveReal of [realpathSync, realpathSync.native]) {
      try {
        realCwds.push(resolveReal(cwd));
      } catch {
        /* keep as-is */
      }
    }
    // For a linked worktree, --git-dir differs from --git-common-dir.
    // Only collapse *worktree toplevels* into the main repo. A session whose
    // cwd is a subdirectory of a repo keeps its own project identity —
    // grouping subdirs under the repo root would change where new sessions
    // are created for existing users.
    const isTopLevel = realCwds.some((candidate) => worktreePathsEqual(toplevel, candidate));
    const isWorktreeTopLevel = !worktreePathsEqual(gitDir, commonDir) && isTopLevel;
    info = {
      // Every toplevel resolves to a git-reported path so the projectRoot
      // format is identical regardless of how cwd was spelled (git prints
      // forward slashes on Windows; a restored session cwd may use
      // backslashes). Session filtering compares projectRoot strings, so a
      // separator mismatch would hide a project's sessions. For the main
      // checkout use toplevel rather than dirname(commonDir): in a submodule
      // commonDir lives under the superproject's .git/modules.
      projectRoot: isWorktreeTopLevel ? dirname(commonDir) : isTopLevel ? toplevel : cwd,
      branch: ref && ref !== "HEAD" ? ref : null,
      isWorktree: isWorktreeTopLevel,
      isTopLevel,
    };
  } catch (error) {
    cacheable = !isToolchainUnavailable(error);
    info = { projectRoot: cwd, branch: null, isWorktree: false, isTopLevel: false };
  }

  if (cacheable) cache.set(cwd, { info, expiresAt: Date.now() + PROJECT_CACHE_TTL_MS });
  return info;
}

function isToolchainUnavailable(error: unknown): boolean {
  const code = (error as { code?: unknown }).code;
  if (code === "TOOLCHAIN_GIT_REQUIRED" || code === "ENOENT") return true;
  const message = error instanceof Error ? error.message : String(error);
  return /TOOLCHAIN_GIT_REQUIRED|spawn git ENOENT/.test(message);
}

function missingProjectInfo(root: string | null): ProjectInfo | null {
  return root ? { projectRoot: root, branch: null, isWorktree: false, isTopLevel: false } : null;
}

function commonDirRoot(directory: string): Promise<string | null> {
  const pending = pendingInferredProjects.get(directory);
  if (pending) return pending;
  const started = git(directory, [
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
    "--git-dir",
    "--show-toplevel",
  ])
    .then((out) => {
      const [commonDir, gitDir, toplevel] = out.split("\n").map((line) => line.trim());
      if (!toplevel) return null;
      return worktreePathsEqual(gitDir, commonDir) ? toplevel : dirname(commonDir);
    })
    .catch(() => null)
    .finally(() => {
      if (pendingInferredProjects.get(directory) === started) pendingInferredProjects.delete(directory);
    });
  pendingInferredProjects.set(directory, started);
  return started;
}

export async function inferMissingProject(cwd: string): Promise<ProjectInfo | null> {
  const removed = inferRemovedWorktree(cwd);
  if (removed) return removed;
  let directory = dirname(cwd);
  while (!existsSync(directory)) {
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
  const cached = inferredProjectCache.get(directory);
  if (cached && cached.expiresAt > Date.now()) return missingProjectInfo(cached.root);
  const root = await commonDirRoot(directory);
  inferredProjectCache.set(directory, { root, expiresAt: Date.now() + PROJECT_CACHE_TTL_MS });
  return missingProjectInfo(root);
}

// ============================================================================
// Worktree operations
//
// These take any directory inside the repo (a worktree, the main checkout, or
// a subdirectory) and resolve the main repo root themselves via the git
// common dir, so callers can pass session cwds directly.
// ============================================================================

/** Main repo root (parent of the shared .git dir), or throws for non-git dirs */
async function getRepoRoot(cwd: string): Promise<string> {
  const commonDir = await git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return dirname(commonDir);
}

export async function listWorktrees(cwd: string): Promise<WorktreeInfo[]> {
  const out = await git(cwd, ["worktree", "list", "--porcelain"]);
  return parseWorktreeList(out)
    .filter((entry) => !entry.stale)
    .map((entry) => ({ path: entry.path, branch: entry.branch, isMain: entry.isMain }));
}

function sanitizeBranchForDir(branch: string): string {
  return branch.replace(/[\/\\:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "");
}

export async function addWorktree(cwd: string, branch: string): Promise<{ path: string; branch: string }> {
  const trimmed = branch.trim();
  if (!trimmed) throw new Error("Branch name is required");

  const dirName = sanitizeBranchForDir(trimmed);
  if (!dirName) throw new Error(`Invalid branch name: ${branch}`);

  const repoRoot = await getRepoRoot(cwd);
  const baseDir = `${resolve(repoRoot)}-worktrees`;
  const worktreePath = join(baseDir, dirName);
  if (existsSync(worktreePath)) {
    throw new Error(`Directory already exists: ${worktreePath}`);
  }
  mkdirSync(baseDir, { recursive: true });

  // Reuse the branch if it already exists, otherwise create it at HEAD.
  let branchExists = false;
  try {
    await git(repoRoot, ["rev-parse", "--verify", "--quiet", `refs/heads/${trimmed}`]);
    branchExists = true;
  } catch {
    branchExists = false;
  }

  try {
    if (branchExists) {
      await git(repoRoot, ["worktree", "add", "--", worktreePath, trimmed]);
    } else {
      await git(repoRoot, ["worktree", "add", "-b", trimmed, "--", worktreePath]);
    }
  } catch (error) {
    throw new Error(extractGitError(error));
  }

  allowFileRoot(worktreePath);
  invalidateProjectCache();
  return { path: worktreePath, branch: trimmed };
}

export async function removeWorktree(cwd: string, worktreePath: string, force = false): Promise<void> {
  const worktrees = await listWorktrees(cwd);
  const target = worktrees.find((w) => worktreePathsEqual(w.path, worktreePath));
  if (!target) throw new Error(`Not a worktree of this repository: ${worktreePath}`);
  if (target.isMain) throw new Error("Cannot remove the main worktree");

  try {
    await git(cwd, ["worktree", "remove", ...(force ? ["--force"] : []), target.path]);
  } catch (error) {
    throw new Error(extractGitError(error));
  }
  invalidateProjectCache();
}

function extractGitError(error: unknown): string {
  const stderr = (error as { stderr?: string }).stderr;
  if (typeof stderr === "string" && stderr.trim()) return stderr.trim();
  return error instanceof Error ? error.message : String(error);
}
