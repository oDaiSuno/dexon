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
      await assertPathAllowed(cwd);
      return getGitStatus(cwd);
    },

    "git.branch": async (params) => {
      const { path: cwd } = params as { path: string };
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
