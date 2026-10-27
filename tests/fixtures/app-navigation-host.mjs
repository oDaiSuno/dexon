import { createDeferred } from "#test-timing";
import { browserState } from "../support/browser-state.mjs";
import {
  createdWorktreeBranch,
  forkedConversation,
  initialSkillContent,
  personalPrepareReason,
  navigationConversations,
  navigationPaths,
  navigationResources,
  reloadedPluginStatus,
  startedConversation,
  toolConversation,
} from "./app-navigation-data.mjs";

// Test answers live at the Main/Host process boundary. The App, components,
// compatibility fetch layer, RPC client and wire protocol remain production code.
export function navigationBoundary({
  history = true,
  lastSpaceCwd = null,
  openProjects,
  emptySkills = false,
  runningSessionIds = [],
  unavailableSpaces = {},
  personalPrepareFailures = 0,
  forks = false,
  dirtyWorktrees = [],
  streamingSessionId = null,
  toolHistory = false,
  browserTabs = [],
  sessionOverrides = {},
  generatedTitle = null,
} = {}) {
  const details = history ? navigationConversations() : [];
  if (history && forks) details.push(forkedConversation());
  if (history && toolHistory) details.push(toolConversation());
  for (const [sessionId, patch] of Object.entries(sessionOverrides)) {
    const detail = details.find((item) => item.sessionId === sessionId);
    if (!detail) throw new Error(`Fixture cannot override unknown session ${sessionId}`);
    if (patch.model) detail.context.model = structuredClone(patch.model);
    if (patch.agentState) detail.agentState = structuredClone(patch.agentState);
  }
  const runningSessions = new Set(runningSessionIds);
  if (streamingSessionId) {
    const detail = details.find((item) => item.sessionId === streamingSessionId);
    if (!detail) throw new Error(`Fixture cannot stream unknown session ${streamingSessionId}`);
    detail.agentState = { running: true, state: { isStreaming: true } };
    runningSessions.add(streamingSessionId);
  }
  const stopRequests = [];
  const prompts = [];
  const sessionReads = new Map();
  const agentListeners = new Map();
  const processListeners = new Set();
  const browser = browserState(structuredClone(browserTabs));
  const nativeSurface = { tabId: null, visible: false };
  const resources = navigationResources();
  if (emptySkills) {
    for (const resource of resources.values()) resource.skills = [];
  }
  const files = new Map();
  for (const resource of resources.values()) {
    for (const skill of resource.skills) files.set(skill.filePath, initialSkillContent);
  }
  const menus = new Map();
  const browserListeners = new Set();
  const deepLinkListeners = new Set();
  const failures = { skillSave: null, openDirectory: null, agentPrompt: null };
  const uiState = { lastSpaceCwd, chatAppearance: { fontSize: "standard", layout: "fixed" } };
  if (openProjects !== undefined) uiState.openProjects = structuredClone(openProjects);
  const missingFolders = new Map(Object.entries(unavailableSpaces));
  const existingFolders = new Set([
    navigationPaths.personal,
    navigationPaths.project,
    navigationPaths.worktree,
    navigationPaths.createdWorktree,
    navigationPaths.terminalOnly,
    navigationPaths.empty,
  ]);
  const updateState = { phase: "idle", currentVersion: "0.1.0", automaticChecksEnabled: false };
  const desktop = { selectedDirectory: null, openedDirectory: null, directoryRequests: 0, openedFiles: [] };
  const unexpected = [];
  const activity = { pending: 0, started: 0 };
  const runningListeners = new Set();
  const sessionChangedListeners = new Set();
  const projectWorktrees = [
    { path: navigationPaths.project, branch: "main", isMain: true },
    { path: navigationPaths.worktree, branch: "review", isMain: false },
  ];
  let remainingPrepareFailures = personalPrepareFailures;
  const toolchainState = {
    schemaVersion: 1,
    revision: 1,
    platform: "darwin",
    arch: "arm64",
    coreReady: true,
    capabilities: {},
    components: {},
    caches: {},
    operations: [],
  };
  let sessionSequence = 0;
  let skillWrites = 0;
  const noSubscription = () => () => {};
  const resourceFor = (cwd) => {
    const resource = resources.get(cwd);
    if (!resource) throw new Error(`Fixture has no resource scope for ${cwd}`);
    return resource;
  };
  const pluginList = (cwd) => ({
    packages: structuredClone(resourceFor(cwd).packages),
    totals: { extensions: 0, skills: 2, prompts: 0, themes: 0 },
    diagnostics: [],
  });
  const modelList = {
    models: [],
    nameMap: {},
    thinkingLevels: {},
    thinkingLevelMaps: {},
    catalog: { source: "cache", refreshed: false, aborted: false, warnings: [] },
    defaultModel: null,
  };
  const sessionFor = (sessionId) => {
    const detail = details.find((item) => item.sessionId === sessionId);
    if (!detail) throw new Error(`Fixture cannot update unknown session ${sessionId}`);
    return detail;
  };
  const announceSession = (detail) => {
    for (const listener of sessionChangedListeners)
      listener({ cwd: detail.info.cwd, session: structuredClone(detail.info) });
  };
  const call = async (method, params) => {
    switch (method) {
      case "system.home":
        return { home: navigationPaths.home };
      case "system.defaultCwd":
        if (remainingPrepareFailures > 0) {
          remainingPrepareFailures--;
          throw new Error(personalPrepareReason);
        }
        return { cwd: navigationPaths.personal };
      case "system.validateCwd":
        if (missingFolders.has(params.path)) return { ok: false, error: missingFolders.get(params.path) };
        return { ok: true, path: params.path };
      case "projects.inspectFolder":
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
      case "agent.new":
        return { sessionId: `new-navigation-session-${++sessionSequence}` };
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
      case "git.branch":
        return { isGit: false, branch: null };
      case "git.headContent":
        return { comparable: false, content: "" };
      case "files.list":
        return { entries: [] };
      case "files.watchStart":
      case "files.watchStop":
        return { ok: true };
      case "worktrees.list":
        return projectWorktrees.some((worktree) => worktree.path === params.projectRoot)
          ? {
              projectRoot: navigationPaths.project,
              isGit: true,
              isTopLevel: true,
              worktrees: structuredClone(projectWorktrees),
            }
          : { projectRoot: params.projectRoot, isGit: false, isTopLevel: false, worktrees: [] };
      case "worktrees.create": {
        if (params.projectRoot !== navigationPaths.project || params.branch !== createdWorktreeBranch)
          throw new Error(`Fixture cannot create worktree ${params.branch} in ${params.projectRoot}`);
        const worktree = { path: navigationPaths.createdWorktree, branch: params.branch, isMain: false };
        projectWorktrees.push(worktree);
        return { worktree: structuredClone(worktree) };
      }
      case "worktrees.remove": {
        const index = projectWorktrees.findIndex((worktree) => worktree.path === params.path && !worktree.isMain);
        if (index < 0) throw new Error(`Fixture cannot remove worktree ${params.path}`);
        if (dirtyWorktrees.includes(params.path) && params.force !== true)
          throw Object.assign(new Error("Fixture worktree has uncommitted changes"), {
            code: "CONFLICT",
            detail: { dirty: true },
          });
        projectWorktrees.splice(index, 1);
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
        skillWrites++;
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
  const holds = [];
  const allHolds = [];
  const passGate = async (method, params) => {
    const index = holds.findIndex((entry) => entry.method === method && entry.matches(params ?? {}));
    if (index < 0) return;
    const [entry] = holds.splice(index, 1);
    entry.reached = true;
    await entry.released.promise;
  };
  const tracked = async (work) => {
    activity.started++;
    activity.pending++;
    try {
      return await work();
    } finally {
      activity.pending--;
    }
  };
  const subscribe = (topic, key, listener) => {
    if (topic === "agent.events") {
      if (!agentListeners.has(key)) agentListeners.set(key, new Set());
      agentListeners.get(key).add(listener);
      return () => agentListeners.get(key)?.delete(listener);
    }
    if (topic === "processes.changed") {
      processListeners.add(listener);
      return () => processListeners.delete(listener);
    }
    if (topic === "sessions.changed") {
      sessionChangedListeners.add(listener);
      return () => sessionChangedListeners.delete(listener);
    }
    if (topic !== "agent.running") return () => {};
    runningListeners.add(listener);
    return () => runningListeners.delete(listener);
  };
  const emitBrowser = (event) => {
    for (const listener of browserListeners) listener(event);
  };
  const desktopBridge = {
    platform: "darwin",
    getUiState: async () => structuredClone(uiState),
    setUiState: async (patch) => {
      Object.assign(uiState, patch);
    },
    getManagedProcessCapability: async () => ({ ready: false }),
    openDirectory: async (directory) => {
      if (failures.openDirectory) throw new Error(failures.openDirectory);
      desktop.openedDirectory = directory;
    },
    openFile: async (filePath) => {
      desktop.openedFiles.push(filePath);
    },
    selectDirectory: async () => {
      desktop.directoryRequests++;
      return desktop.selectedDirectory;
    },
    openExternal: async () => {},
    onMenu(command, listener) {
      if (!menus.has(command)) menus.set(command, new Set());
      menus.get(command).add(listener);
      return () => menus.get(command).delete(listener);
    },
    onHostRestarted: noSubscription,
    onHostCrashed: noSubscription,
    onDeepLinkSession(listener) {
      deepLinkListeners.add(listener);
      return () => deepLinkListeners.delete(listener);
    },
    onBrowserEvent(listener) {
      browserListeners.add(listener);
      return () => browserListeners.delete(listener);
    },
    browserGetState: async () => structuredClone(browser),
    browserGetSettings: async () => structuredClone(browser.settings),
    browserListPageSnippets: async () => [],
    browserGetHeaderRules: async () => [],
    browserSetSurfaceVisible: async ({ tabId, visible }) => {
      if (tabId) nativeSurface.tabId = tabId;
      nativeSurface.visible = visible;
    },
    browserSetBounds: async () => {},
    browserActivateTab: async (tabId) => {
      browser.activeTabId = tabId;
      nativeSurface.tabId = tabId;
      emitBrowser({ type: "active-tab-changed", tabId });
    },
    browserRespondAgentAuthorization: async () => {},
    onUpdateState: noSubscription,
    getUpdateState: async () => ({ ...updateState }),
    checkForUpdates: async () => ({ ...updateState }),
    onToolchainState: noSubscription,
    getToolchainState: async () => structuredClone(toolchainState),
    rescanToolchains: async () => structuredClone(toolchainState),
    clearBadge: async () => {},
    setRunningCount: async () => {},
  };
  // Desktop preference writes, directory pickers and folder opening are
  // asynchronous Main-process work too; settled() must wait for them as well.
  const bridge = Object.fromEntries(
    Object.entries(desktopBridge).map(([name, value]) =>
      typeof value !== "function" || name.startsWith("on")
        ? [name, value]
        : [
            name,
            (...args) =>
              tracked(async () => {
                await passGate(`desktop.${name}`, args[0] ?? {});
                return value(...args);
              }),
          ],
    ),
  );
  return {
    host: {
      call: (method, params) =>
        tracked(async () => {
          await passGate(method, params);
          return call(method, params);
        }),
      subscribe,
    },
    bridge,
    desktop,
    failures,
    unexpected,
    activity: () => ({ ...activity }),
    rememberedSpace: () => uiState.lastSpaceCwd,
    // The folder disappears from (or comes back to) this computer.
    removeFolder(folder, reason = "Fixture folder was removed from this computer") {
      missingFolders.set(folder, reason);
    },
    restoreFolder(folder) {
      missingFolders.delete(folder);
      existingFolders.add(folder);
    },
    hold(method, matches = () => true) {
      const entry = { method, matches, reached: false, released: createDeferred() };
      entry.released.promise.catch(() => {});
      holds.push(entry);
      allHolds.push(entry);
      return {
        reached: () => entry.reached,
        release: () => entry.released.resolve(),
        fail: (message) => entry.released.reject(new Error(message)),
      };
    },
    // A test that fails mid-way must not leave a held request hanging.
    releaseHolds() {
      holds.length = 0;
      for (const entry of allHolds) entry.released.resolve();
    },
    // Skill file writes that reached the Host, whether or not they succeeded.
    skillWrites: () => skillWrites,
    // Gives one skill file distinct text, so a test can tell whose file is shown.
    writeSkillFile(filePath, content) {
      if (!files.has(filePath)) throw new Error(`Fixture has no skill file ${filePath}`);
      files.set(filePath, content);
    },
    addConversation(detail) {
      details.push(detail);
    },
    runningSubscribers: () => runningListeners.size,
    sessionChangedSubscribers: () => sessionChangedListeners.size,
    running(sessionIds, sessionStatuses = {}) {
      runningSessions.clear();
      for (const id of sessionIds) runningSessions.add(id);
      for (const listener of runningListeners)
        listener({
          type: "running",
          sessionIds: [...sessionIds],
          runningSessionIds: [...sessionIds],
          sessionStatuses,
        });
    },
    updateSession(sessionId, patch) {
      const detail = sessionFor(sessionId);
      Object.assign(detail.info, patch);
      announceSession(detail);
    },
    // The Host's view of user stop requests: the observable side effect of
    // an abort, not a log of renderer calls.
    stopRequests: () => [...stopRequests],
    prompts: () => structuredClone(prompts),
    sessionReads: (sessionId) => sessionReads.get(sessionId) ?? 0,
    agentSubscribers: (sessionId) => agentListeners.get(sessionId)?.size ?? 0,
    agentEvent(sessionId, event) {
      for (const listener of agentListeners.get(sessionId) ?? []) listener(event);
    },
    streamReply(sessionId, text) {
      const detail = details.find((item) => item.sessionId === sessionId);
      if (!detail?.agentState?.state) throw new Error(`Fixture cannot stream into ${sessionId}`);
      const message = { ...assistantReply(text), stopReason: undefined };
      detail.agentState.state.streamingMessage = message;
      for (const listener of agentListeners.get(sessionId) ?? []) listener({ type: "message_update", message });
    },
    // Ends a streamed turn the way the Host does: the session file gains the
    // final reply, live state becomes idle, then the stream and running set report it.
    finishStream(sessionId, text) {
      const detail = details.find((item) => item.sessionId === sessionId);
      if (!detail) throw new Error(`Fixture cannot finish unknown session ${sessionId}`);
      detail.context.messages.push(assistantReply(text));
      detail.context.entryIds.push(`${sessionId}-final`);
      detail.context.historyRevision = `${sessionId}-finished`;
      detail.agentState = { running: false };
      for (const listener of agentListeners.get(sessionId) ?? []) listener({ type: "agent_end" });
      runningSessions.delete(sessionId);
      for (const listener of runningListeners) listener({ type: "running", sessionIds: [...runningSessions] });
    },
    processCreated(processId) {
      for (const listener of processListeners)
        listener({ revision: 2, processId, runId: `${processId}-run`, reason: "created", activateUi: true });
    },
    nativeSurface: () => ({ ...nativeSurface }),
    browserTabCreated(tab) {
      browser.tabs.push(structuredClone(tab));
      emitBrowser({ type: "tab-created", tab: structuredClone(tab) });
    },
    menu(command) {
      for (const listener of menus.get(command) ?? []) listener();
    },
    deepLink(sessionId) {
      for (const listener of deepLinkListeners) listener(sessionId);
    },
    browserEvent: emitBrowser,
  };
}

export function assistantReply(text) {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    provider: "navigation-fixture",
    model: "navigation-model",
    stopReason: "stop",
    timestamp: 3,
  };
}
