import { existsSync } from "fs";
import type { RpcServer } from "../../contract/rpc";
import { RpcError } from "../../contract/types";
import { allowFileRoot, assertPathAllowed } from "../file-access";
import { browseFolders } from "../folder-browse";
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
      await assertPathAllowed(projectRoot);
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
      await assertPathAllowed(cwd);
      const result = await addWorktree(cwd, body.branch);
      allowFileRoot(result.path);
      return { worktree: result };
    },

    "worktrees.remove": async (params) => {
      const body = params as { path: string; cwd?: string; force?: boolean };
      const cwd = body.cwd ?? body.path;
      await assertPathAllowed(cwd);
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
      await assertPathAllowed(cwd);
      return listBranches(cwd);
    },

    "worktrees.switchBranch": async (params) => {
      const body = params as { cwd: string; branch: string };
      await assertPathAllowed(body.cwd);
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

    "projects.browse": async (params) => browseFolders((params as { path: string }).path),
  });
}
