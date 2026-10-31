import { realpathSync } from "fs";
import { git } from "./git-command.ts";
import { folderContains, parseWorktreeList, type ParsedWorktree } from "./worktree-list.ts";
import { worktreePathsEqual } from "./worktree-path.ts";

export interface BranchInfo {
  name: string;
  isCurrent: boolean;
  committedAt: string;
  worktreePath: string | null;
  isMainFolder: boolean;
  stalePath: string | null;
}

export interface DetachedWorktreeInfo {
  path: string;
  commit: string;
  isMainFolder: false;
}

export interface BranchListing {
  projectRoot: string;
  isGit: boolean;
  isTopLevel: boolean;
  current: string | null;
  mainFolder: string | null;
  branches: BranchInfo[];
  detached: DetachedWorktreeInfo[];
}

export type SwitchBranchResult =
  { ok: true } | { ok: false; reason: "occupied" | "stale" | "dirty" | "busy"; path?: string };

export interface SwitchBranchDeps {
  runningSessionCwds: () => readonly string[];
  activeProcessCwds: () => readonly string[];
  worktreePaths: readonly string[];
}

const BRANCH_FIELD_SEPARATOR = "\u0000";

function realOrSelf(target: string): string {
  const resolveReal = realpathSync.native ?? realpathSync;
  try {
    return resolveReal(target);
  } catch {
    return target;
  }
}

function samePath(left: string, right: string): boolean {
  return worktreePathsEqual(realOrSelf(left), realOrSelf(right));
}

function notGitListing(cwd: string, isTopLevel = false): BranchListing {
  return {
    projectRoot: cwd,
    isGit: false,
    isTopLevel,
    current: null,
    mainFolder: null,
    branches: [],
    detached: [],
  };
}

async function readWorktrees(cwd: string): Promise<ParsedWorktree[] | null> {
  try {
    return parseWorktreeList(await git(cwd, ["worktree", "list", "--porcelain"]));
  } catch {
    return null;
  }
}

async function readToplevel(cwd: string): Promise<boolean> {
  try {
    const toplevel = await git(cwd, ["rev-parse", "--show-toplevel"]);
    return Boolean(toplevel) && samePath(toplevel, cwd);
  } catch {
    return false;
  }
}

export async function listBranches(cwd: string): Promise<BranchListing> {
  const worktrees = await readWorktrees(cwd);
  if (!worktrees) return notGitListing(cwd);
  const isTopLevel = await readToplevel(cwd);
  if (worktrees.length === 0) return notGitListing(cwd, isTopLevel);

  const valid = worktrees.filter((entry) => !entry.stale);
  const mainFolder = valid.find((entry) => entry.isMain)?.path ?? null;

  let refs: { name: string; isCurrent: boolean; committedAt: string }[];
  try {
    const raw = await git(cwd, [
      "for-each-ref",
      "--sort=-committerdate",
      "--format=%(refname:short)%00%(HEAD)%00%(committerdate:iso-strict)",
      "refs/heads",
    ]);
    refs = raw
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => {
        const [name, head, committedAt] = line.split(BRANCH_FIELD_SEPARATOR);
        return { name, isCurrent: head === "*", committedAt };
      });
  } catch {
    return notGitListing(cwd, isTopLevel);
  }

  const holderOf = new Map<string, ParsedWorktree>();
  const staleOf = new Map<string, string>();
  for (const entry of worktrees) {
    if (!entry.branch) continue;
    if (entry.stale) {
      if (!staleOf.has(entry.branch)) staleOf.set(entry.branch, entry.path);
      continue;
    }
    if (!holderOf.has(entry.branch)) holderOf.set(entry.branch, entry);
  }

  const branches: BranchInfo[] = refs.map((ref) => {
    const holder = holderOf.get(ref.name);
    return {
      name: ref.name,
      isCurrent: ref.isCurrent,
      committedAt: ref.committedAt,
      worktreePath: holder?.path ?? null,
      isMainFolder: Boolean(holder && mainFolder && samePath(holder.path, mainFolder)),
      stalePath: holder ? null : (staleOf.get(ref.name) ?? null),
    };
  });

  const detached: DetachedWorktreeInfo[] = valid
    .filter((entry) => entry.detached)
    .map((entry) => ({
      path: entry.path,
      commit: (entry.head ?? "").slice(0, 8),
      isMainFolder: false,
    }));

  return {
    projectRoot: mainFolder ?? cwd,
    isGit: true,
    isTopLevel,
    current: branches.find((entry) => entry.isCurrent)?.name ?? null,
    mainFolder,
    branches,
    detached,
  };
}

async function trackedChanges(cwd: string): Promise<boolean> {
  const status = await git(cwd, ["status", "--porcelain", "--untracked-files=no"]);
  return status.length > 0;
}

function busyIn(cwd: string, deps: SwitchBranchDeps): boolean {
  const root = realOrSelf(cwd);
  const nestedWorktrees = deps.worktreePaths.filter(
    (entry) => !samePath(entry, root) && folderContains(root, realOrSelf(entry)),
  );
  const counts = (folder: string) => {
    const resolved = realOrSelf(folder);
    if (!folderContains(root, resolved)) return false;
    return !nestedWorktrees.some((worktree) => folderContains(realOrSelf(worktree), resolved));
  };
  return [...deps.runningSessionCwds(), ...deps.activeProcessCwds()].some(counts);
}

export async function switchBranch(cwd: string, branch: string, deps: SwitchBranchDeps): Promise<SwitchBranchResult> {
  const target = branch.trim();
  if (!target) throw new Error("Branch name is required");

  const worktrees = await readWorktrees(cwd);
  if (!worktrees) throw new Error(`Not a Git repository: ${cwd}`);
  if (!(await readToplevel(cwd))) throw new Error(`Not the root of a checkout: ${cwd}`);

  const valid = worktrees.filter((entry) => !entry.stale);
  const holder = valid.find((entry) => entry.branch === target && !samePath(entry.path, cwd));
  if (holder) return { ok: false, reason: "occupied", path: holder.path };

  const stale = worktrees.find((entry) => entry.stale && entry.branch === target);
  if (stale) return { ok: false, reason: "stale", path: stale.path };

  const knownLocalBranch = await git(cwd, ["rev-parse", "--verify", "--quiet", `refs/heads/${target}`]).then(
    () => true,
    () => false,
  );
  if (!knownLocalBranch) throw new Error(`No such local branch: ${target}`);

  if (await trackedChanges(cwd)) return { ok: false, reason: "dirty" };
  if (busyIn(cwd, deps)) return { ok: false, reason: "busy" };

  try {
    await git(cwd, ["switch", "--no-guess", target]);
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr;
    throw new Error(typeof stderr === "string" && stderr.trim() ? stderr.trim() : String(error));
  }
  return { ok: true };
}
