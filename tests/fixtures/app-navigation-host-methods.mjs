import {
  navigationPaths,
  personalPrepareReason,
  startedConversation,
  reloadedPluginStatus,
} from "./app-navigation-data.mjs";

export function createNavigationHostMethods({
  missingFolders,
  existingFolders,
  details,
  runningSessions,
  sessionFor,
  announceSession,
  sessionReads,
  stopRequests,
  failures,
  prompts,
  generatedTitle,
  modelList,
  repositoryAt,
  branchOfFolder,
  checkoutAt,
  dirtyFolders,
  busyFolders,
  dirtyWorktrees,
  pluginList,
  resourceFor,
  files,
  unexpected,
  state,
}) {
  return async (method, params) => {
    switch (method) {
      case "system.home":
        return { home: navigationPaths.home };
      case "system.defaultCwd":
        if (state.remainingPrepareFailures > 0) {
          state.remainingPrepareFailures--;
          throw new Error(personalPrepareReason);
        }
        return { cwd: navigationPaths.personal };
      case "system.validateCwd":
        if (missingFolders.has(params.path)) return { ok: false, error: missingFolders.get(params.path) };
        return { ok: true, path: params.path };
      case "projects.browse":
        return existingFolders.has(params.path) && !missingFolders.has(params.path)
          ? { ok: true, path: params.path }
          : { ok: false, error: "Directory does not exist" };
      case "sessions.list":
        return {
          sessions: structuredClone(details.map((detail) => detail.info)),
          runningSessionIds: [...runningSessions],
        };
      case "sessions.rename": {
        const detail = sessionFor(params.id);
        detail.info.name = params.name;
        announceSession(detail);
        return { ok: true };
      }
      case "sessions.descendants": {
        const found = [];
        for (let frontier = [params.id]; frontier.length > 0;) {
          const children = details
            .filter((item) => frontier.includes(item.info.parentSessionId) && !found.includes(item.sessionId))
            .map((item) => item.sessionId);
          found.push(...children);
          frontier = children;
        }
        return { sessionIds: found, runningSessionIds: found.filter((id) => runningSessions.has(id)) };
      }
      case "sessions.delete": {
        const index = details.findIndex((item) => item.sessionId === params.id);
        if (index < 0) throw new Error(`Cannot delete unknown session ${params.id}`);
        details.splice(index, 1);
        return { ok: true };
      }
      case "sessions.get": {
        sessionReads.set(params.id, (sessionReads.get(params.id) ?? 0) + 1);
        const detail = details.find((item) => item.sessionId === params.id);
        if (!detail) throw new Error(`Fixture has no session ${params.id}`);
        return structuredClone(detail);
      }
      case "sessions.contextPage": {
        const detail = details.find((item) => item.sessionId === params.id);
        if (!detail) throw new Error(`Fixture has no session ${params.id}`);
        const page = detail.pages?.[params.cursor];
        if (!page) throw new Error(`STALE_CURSOR: the fixture has no page behind cursor ${params.cursor}`);
        return structuredClone(page);
      }
      case "agent.new":
        return { sessionId: `new-navigation-session-${++state.sessionSequence}` };
      case "agent.state":
        return structuredClone(
          details.find((item) => item.sessionId === params.sessionId)?.agentState ?? { running: false },
        );
      case "agent.command": {
        if (params.command.type === "get_commands") return { commands: [] };
        if (params.command.type === "abort") {
          stopRequests.push(params.sessionId);
          return {};
        }
        if (params.command.type === "prompt") {
          const failure = failures.agentPrompt;
          if (failure && (!failure.sessionId || failure.sessionId === params.sessionId))
            throw Object.assign(new Error(failure.message), { code: failure.code, detail: failure.detail });
          prompts.push({ sessionId: params.sessionId, message: params.command.message });
          if (!details.some((item) => item.sessionId === params.sessionId)) {
            const started = startedConversation(params.sessionId, navigationPaths.personal, params.command.message);
            started.agentState = { running: true, state: { isStreaming: true } };
            details.push(started);
            runningSessions.add(params.sessionId);
          }
          return {};
        }
        if (params.command.type === "set_session_name") {
          const detail = sessionFor(params.sessionId);
          detail.info.name = params.command.name;
          announceSession(detail);
          return null;
        }
        if (params.command.type === "get_session_stats") {
          const detail = sessionFor(params.sessionId);
          return {
            sessionId: detail.sessionId,
            sessionFile: detail.info.path,
            sessionName: detail.info.name,
            userMessages: 1,
            assistantMessages: 0,
            toolCalls: 0,
            toolResults: 0,
            totalMessages: 1,
            tokens: { input: 1_200, output: 0, cacheRead: 0, cacheWrite: 0, total: 1_200 },
            cost: 0.01,
          };
        }
        if (params.command.type === "reload") {
          const detail = details.find((item) => item.sessionId === params.sessionId);
          if (!detail) throw new Error(`Cannot reload unknown session ${params.sessionId}`);
          detail.agentState = {
            running: false,
            state: { extensionStatuses: [{ key: "navigation-plugin", text: reloadedPluginStatus }] },
          };
          return {};
        }
        throw new Error(`Fixture has no agent command ${params.command.type}`);
      }
      case "agent.generateTitle": {
        if (generatedTitle === null) return { title: null };
        const detail = sessionFor(params.sessionId);
        detail.info.name = generatedTitle;
        announceSession(detail);
        return { title: generatedTitle };
      }
      case "models.list":
        return modelList;
      case "modelsConfig.get":
        return { config: { providers: {} }, version: "navigation-fixture-v1" };
      case "modelsConfig.channels.get":
        return { channels: {} };
      case "models.preferences.get":
        return { enabledModels: null, models: [] };
      case "models.defaults.get":
        return { model: null, thinkingLevel: "medium" };
      case "auth.providers":
      case "auth.allProviders":
        return { providers: [] };
      case "channels.list":
        return { accounts: [], statuses: [], pairings: [], bindings: [], activities: [] };
      case "processes.list":
        return { revision: 1, processes: [] };
      case "git.status":
        return {
          isGit: false,
          branch: null,
          clean: true,
          staged: 0,
          modified: 0,
          untracked: 0,
          conflicted: 0,
          entries: [],
        };
      case "git.branch": {
        const found = repositoryAt(params.path);
        if (!found) return { isGit: false, branch: null };
        return { isGit: true, branch: branchOfFolder(found.repository, found) };
      }
      case "git.headContent":
        return { comparable: false, content: "" };
      case "files.list": {
        const found = repositoryAt(params.path);
        if (!found) return { entries: [] };
        const names = found.repository.files?.[branchOfFolder(found.repository, found)] ?? [];
        return {
          entries: names.map((name) => ({ name, type: "file", isDir: false, size: 1, mtime: 0 })),
        };
      }
      case "files.watchStart":
      case "files.watchStop":
        return { ok: true };
      case "worktrees.list": {
        const found = repositoryAt(params.projectRoot);
        if (!found) return { projectRoot: params.projectRoot, isGit: false, isTopLevel: false, worktrees: [] };
        const { repository, isTopLevel } = found;
        const worktrees = [
          ...repository.branches
            .filter((entry) => entry.worktreePath)
            .map((entry) => ({
              path: entry.worktreePath,
              branch: entry.name,
              isMain: entry.worktreePath === repository.mainFolder,
            })),
          ...repository.detached.map((entry) => ({ path: entry.path, branch: null, isMain: false })),
        ].sort((left, right) => Number(right.isMain) - Number(left.isMain));
        return { projectRoot: repository.root, isGit: true, isTopLevel, worktrees };
      }
      case "worktrees.branches": {
        const found = repositoryAt(params.cwd);
        if (!found)
          return {
            projectRoot: params.cwd,
            isGit: false,
            isTopLevel: false,
            current: null,
            mainFolder: null,
            branches: [],
            detached: [],
          };
        const { repository, isTopLevel, folder } = found;
        const checkout = checkoutAt(repository, folder);
        return {
          projectRoot: repository.root,
          isGit: true,
          isTopLevel,
          current: checkout?.branch?.name ?? null,
          mainFolder: repository.mainFolder,
          branches: [...repository.branches]
            .sort((left, right) => right.committedAt.localeCompare(left.committedAt))
            .map((entry) => ({
              name: entry.name,
              isCurrent: entry.worktreePath === folder,
              committedAt: entry.committedAt,
              worktreePath: entry.worktreePath ?? null,
              isMainFolder: entry.worktreePath === repository.mainFolder,
              stalePath: entry.worktreePath ? null : (entry.stalePath ?? null),
            })),
          detached: repository.detached.map((entry) => ({
            path: entry.path,
            commit: entry.commit,
            isMainFolder: false,
          })),
        };
      }
      case "worktrees.switchBranch": {
        const found = repositoryAt(params.cwd);
        if (!found || !found.isTopLevel) throw new Error(`Fixture cannot switch branch in ${params.cwd}`);
        const { repository, folder } = found;
        const target = repository.branches.find((entry) => entry.name === params.branch);
        if (!target) throw new Error(`Fixture has no branch ${params.branch}`);
        const holder = repository.branches.find(
          (entry) => entry.name === params.branch && entry.worktreePath && entry.worktreePath !== folder,
        );
        if (holder) return { ok: false, reason: "occupied", path: holder.worktreePath };
        if (!target.worktreePath && target.stalePath) return { ok: false, reason: "stale", path: target.stalePath };
        if (dirtyFolders.includes(folder)) return { ok: false, reason: "dirty" };
        if (busyFolders.includes(folder)) return { ok: false, reason: "busy" };
        const current = repository.branches.find((entry) => entry.worktreePath === folder);
        if (current) delete current.worktreePath;
        target.worktreePath = folder;
        return { ok: true };
      }
      case "worktrees.create": {
        const found = repositoryAt(params.cwd ?? params.projectRoot);
        if (!found) throw new Error(`Fixture cannot create worktree ${params.branch} in ${params.projectRoot}`);
        const { repository } = found;
        if (repository.branches.some((entry) => entry.name === params.branch && entry.worktreePath))
          throw new Error(`Fixture branch ${params.branch} is already checked out`);
        const path = `${repository.root}-worktrees/${params.branch.replace(/[/\\:*?"<>|\s]+/g, "-")}`;
        const known = repository.branches.find((entry) => entry.name === params.branch);
        if (known) {
          known.worktreePath = path;
          delete known.stalePath;
        } else {
          repository.branches.push({
            name: params.branch,
            committedAt: repository.branches[0].committedAt,
            worktreePath: path,
          });
        }
        existingFolders.add(path);
        return { worktree: { path, branch: params.branch, isMain: false } };
      }
      case "worktrees.remove": {
        const found = repositoryAt(params.cwd ?? params.path);
        if (!found) throw new Error(`Fixture cannot remove worktree ${params.path}`);
        const { repository } = found;
        const target = repository.branches.find(
          (entry) => entry.worktreePath === params.path && entry.worktreePath !== repository.mainFolder,
        );
        if (!target) throw new Error(`Fixture cannot remove worktree ${params.path}`);
        if (dirtyWorktrees.includes(params.path) && params.force !== true)
          throw Object.assign(new Error("Fixture worktree has uncommitted changes"), {
            code: "CONFLICT",
            detail: { dirty: true },
          });
        delete target.worktreePath;
        return { ok: true };
      }
      case "plugins.list":
        return pluginList(params?.cwd);
      case "plugins.set": {
        const pkg = resourceFor(params.cwd).packages.find(
          (item) => item.source === params.source && item.scope === params.scope,
        );
        if (!pkg || !["enable", "disable"].includes(params.action))
          throw new Error("Unsupported fixture plugin mutation");
        pkg.disabled = params.action === "disable";
        pkg.status = pkg.disabled ? "disabled" : "loaded";
        return pluginList(params.cwd);
      }
      case "plugins.markReloaded":
        return pluginList(params.cwd);
      case "skills.list":
        return { skills: structuredClone(resourceFor(params?.cwd).skills) };
      case "skills.getContent":
        if (!resourceFor(params.cwd).skills.some((item) => item.filePath === params.filePath))
          throw new Error("Skill belongs to a different space");
        return { content: files.get(params.filePath) };
      case "skills.set":
        state.skillWrites++;
        if (!resourceFor(params.cwd).skills.some((item) => item.filePath === params.filePath))
          throw new Error("Skill belongs to a different space");
        if (typeof params.disableModelInvocation !== "boolean") throw new Error("Fixture expects a visibility change");
        resourceFor(params.cwd).skills.find((item) => item.filePath === params.filePath).disableModelInvocation =
          params.disableModelInvocation;
        return { ok: true };
      default:
        unexpected.push(method);
        throw new Error(`Unexpected navigation boundary request: ${method}`);
    }
  };
}
