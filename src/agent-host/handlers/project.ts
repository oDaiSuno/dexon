import { existsSync } from "fs";
import { homedir } from "os";
import path from "path";
import type { RpcServer } from "../../contract/rpc";
import { RpcError } from "../../contract/types";
import { allowFileRoot, assertPathAllowed, getAllowedFileRoots, isFilePathAllowed } from "../file-access";
import { validateExistingDirectory } from "../file-access-core";
import type { ManagedProcessService } from "../managed-process/service";
import { listBranches, switchBranch } from "../../shared/git-branches";
import {
  addWorktree,
  getGitBranch,
  getGitHeadContent,
  getGitStatus,
  isDirtyWorktreeError,
  invalidateProjectCache,
  listWorktrees,
  removeWorktree,
  resolveProject,
} from "../../shared/worktree";
import { parseWorkspaceInput, keyOf, describeWorkspaceKey } from "../../shared/workspace-ref";
import { getOrCreateHost } from "../workspace/registry";
export interface ProjectHandlerDeps {
  managedProcesses: ManagedProcessService;
  runningSessionCwds: () => readonly string[];
}

export function registerProjectHandlers(server: RpcServer, deps: ProjectHandlerDeps): void {
  const { managedProcesses, runningSessionCwds } = deps;

  server.handle({
    "worktrees.list": async (params) => {
      const { projectRoot } = params as { projectRoot: string };
      const allowed = await getAllowedFileRoots();
      if (!isFilePathAllowed(projectRoot, allowed)) {
        throw new RpcError({ code: "FORBIDDEN", message: "Access denied" });
      }
      const project = await resolveProject(projectRoot);
      let worktrees: Awaited<ReturnType<typeof listWorktrees>> = [];
      let isGit = true;
      try {
        worktrees = await listWorktrees(existsSync(projectRoot) ? projectRoot : project.projectRoot);
      } catch {
        isGit = false;
      }
      for (const w of worktrees) allowFileRoot(w.path);
      return {
        worktrees,
        projectRoot: project.projectRoot,
        isGit,
        isTopLevel: project.isTopLevel,
      };
    },

    "worktrees.create": async (params) => {
      const body = params as { projectRoot: string; branch: string; cwd?: string };
      const cwd = body.cwd ?? body.projectRoot;
      const allowed = await getAllowedFileRoots();
      if (!isFilePathAllowed(cwd, allowed)) {
        throw new RpcError({ code: "FORBIDDEN", message: "Access denied" });
      }
      const result = await addWorktree(cwd, body.branch);
      allowFileRoot(result.path);
      return { worktree: result };
    },

    "worktrees.remove": async (params) => {
      const body = params as { path: string; cwd?: string; force?: boolean };
      const cwd = body.cwd ?? body.path;
      const allowed = await getAllowedFileRoots();
      if (!isFilePathAllowed(cwd, allowed)) {
        throw new RpcError({ code: "FORBIDDEN", message: "Access denied" });
      }
      const activeProcesses = managedProcesses.activeWithinCwd(body.path);
      if (activeProcesses.length > 0) {
        throw new RpcError({
          code: "CONFLICT",
          message: "Worktree still contains active managed processes. Stop them before removing it.",
          detail: { managedProcessCount: activeProcesses.length },
        });
      }
      try {
        await removeWorktree(cwd, body.path, body.force === true);
      } catch (error) {
        if (!body.force && isDirtyWorktreeError(error)) {
          throw new RpcError({
            code: "CONFLICT",
            message: error instanceof Error ? error.message : String(error),
            detail: { dirty: true },
          });
        }
        throw error;
      }
      return { ok: true as const };
    },

    "worktrees.branches": async (params) => {
      const { cwd } = params as { cwd: string };
      const sshParsed = parseWorkspaceInput(cwd);
      if (sshParsed.ok && sshParsed.value.kind === "ssh") {
        const ref = sshParsed.value;
        const host = getOrCreateHost(keyOf(ref));
        if (!host) throw new RpcError({ code: "BAD_REQUEST", message: "SSH host not available" });
        const snapshot = await host.request("gitSnapshot", { cwd: ref.root });
        return {
          projectRoot: snapshot.projectRoot || ref.root,
          isGit: snapshot.isGitRepo,
          isTopLevel: true,
          current: snapshot.currentBranch ?? null,
          mainFolder: ref.root,
          branches: snapshot.branches.map((b) => ({
            name: b.name,
            isCurrent: b.current,
            committedAt: b.committedAt,
            worktreePath: null,
            isMainFolder: b.current,
            stalePath: null,
          })),
          detached: [],
        };
      }
      return listBranches(cwd);
    },

    "worktrees.switchBranch": async (params) => {
      const body = params as { cwd: string; branch: string };
      const allowed = await getAllowedFileRoots();
      if (!isFilePathAllowed(body.cwd, allowed)) {
        throw new RpcError({ code: "FORBIDDEN", message: "Access denied" });
      }
      const project = await resolveProject(body.cwd);
      if (!project.isTopLevel) {
        throw new RpcError({ code: "BAD_REQUEST", message: "Only the root of a checkout can switch branches" });
      }
      const listing = await listBranches(body.cwd);
      if (!listing.isGit) {
        throw new RpcError({ code: "BAD_REQUEST", message: "Not a Git repository" });
      }
      const result = await switchBranch(body.cwd, body.branch, {
        runningSessionCwds,
        activeProcessCwds: () => managedProcesses.activeCwds(),
        worktreePaths: [
          ...listing.branches.flatMap((entry) => (entry.worktreePath ? [entry.worktreePath] : [])),
          ...listing.detached.map((entry) => entry.path),
        ],
      });
      if (result.ok) invalidateProjectCache();
      return result;
    },

    "git.status": async (params) => {
      const { path: cwd } = params as { path: string };
      const sshParsed = parseWorkspaceInput(cwd);
      if (sshParsed.ok && sshParsed.value.kind === "ssh") {
        const ref = sshParsed.value;
        const host = getOrCreateHost(keyOf(ref));
        if (!host) throw new RpcError({ code: "BAD_REQUEST", message: "SSH host not available" });
        const snapshot = await host.request("gitSnapshot", { cwd: ref.root });
        if (!snapshot.isGitRepo) {
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
        return {
          isGit: true,
          branch: snapshot.currentBranch,
          clean: true,
          staged: 0,
          modified: 0,
          untracked: 0,
          conflicted: 0,
          entries: [],
          upstream: snapshot.aheadBehind
            ? { ahead: snapshot.aheadBehind.ahead, behind: snapshot.aheadBehind.behind }
            : null,
        };
      }
      await assertPathAllowed(cwd);
      return getGitStatus(cwd);
    },

    "git.branch": async (params) => {
      const { path: cwd } = params as { path: string };
      const sshParsed = parseWorkspaceInput(cwd);
      if (sshParsed.ok && sshParsed.value.kind === "ssh") {
        const ref = sshParsed.value;
        const host = getOrCreateHost(keyOf(ref));
        if (!host) throw new RpcError({ code: "BAD_REQUEST", message: "SSH host not available" });
        const snapshot = await host.request("gitSnapshot", { cwd: ref.root });
        return { isGit: snapshot.isGitRepo, branch: snapshot.currentBranch ?? null };
      }
      await assertPathAllowed(cwd);
      return getGitBranch(cwd);
    },

    "git.headContent": async (params) => {
      const { path: filePath, sourceSessionId } = params as { path: string; sourceSessionId?: string };
      await assertPathAllowed(filePath, sourceSessionId);
      return getGitHeadContent(filePath);
    },

    "projects.inspectFolder": async (params) => {
      const { path: typed } = params as { path: string };
      const sshParsed = parseWorkspaceInput(typed);
      if (sshParsed.ok && sshParsed.value.kind === "ssh") {
        const ref = sshParsed.value;
        const host = getOrCreateHost(keyOf(ref));
        if (!host) throw new RpcError({ code: "BAD_REQUEST", message: "SSH host not available" });
        const meta = await host.request("fileMeta", { path: ref.root, withinRoot: null }).catch(() => null);
        if (!meta || !meta.isDirectory) return { ok: false as const, error: "Directory not found on remote server" };
        const gitInfo = await host.request("gitSnapshot", { cwd: ref.root }).catch(() => null);
        const described = describeWorkspaceKey(keyOf(ref));
        return {
          ok: true as const,
          path: keyOf(ref),
          name: described.folderName,
          isGitRepo: gitInfo?.isGitRepo ?? false,
        };
      }
      const expanded =
        typed === "~"
          ? homedir()
          : typed.startsWith("~/") || typed.startsWith("~\\")
            ? path.join(homedir(), typed.slice(2))
            : typed;
      if (!path.isAbsolute(expanded)) return { ok: false as const, error: "Not an absolute path" };
      const validation = validateExistingDirectory(expanded);
      if (!validation.ok) return { ok: false as const, error: validation.error };
      return { ok: true as const, path: validation.path };
    },
  });
}
