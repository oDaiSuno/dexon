import { createNavigationHostMethods } from "./app-navigation-host-methods.mjs";
import { createDeferred } from "#test-timing";
import { browserState } from "../support/browser-state.mjs";
import {
  forkedConversation,
  initialSkillContent,
  navigationConversations,
  navigationPaths,
  navigationRepositories,
  navigationResources,
  notesConversation,
  toolConversation,
} from "./app-navigation-data.mjs";
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
  dirtyFolders = [],
  busyFolders = [],
  platform = "darwin",
  streamingSessionId = null,
  toolHistory = false,
  notesHistory = false,
  browserTabs = [],
  sessionOverrides = {},
  generatedTitle = null,
} = {}) {
  const details = history ? navigationConversations() : [];
  if (history && forks) details.push(forkedConversation());
  if (history && toolHistory) details.push(toolConversation());
  if (history && notesHistory) details.push(notesConversation());
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
  missingFolders.set(navigationPaths.staleCheckout, "Directory does not exist");
  const existingFolders = new Set([
    navigationPaths.personal,
    navigationPaths.project,
    navigationPaths.worktree,
    navigationPaths.bisect,
    navigationPaths.alphaWorktree,
    navigationPaths.createdWorktree,
    navigationPaths.subfolder,
    navigationPaths.other,
    navigationPaths.otherWorktree,
    navigationPaths.terminalOnly,
    navigationPaths.empty,
  ]);
  const updateState = { phase: "idle", currentVersion: "0.1.0", automaticChecksEnabled: false };
  const desktop = { selectedDirectory: null, openedDirectory: null, directoryRequests: 0, openedFiles: [] };
  const unexpected = [];
  const requests = [];
  const activity = { pending: 0, started: 0 };
  const runningListeners = new Set();
  const sessionChangedListeners = new Set();
  const repositories = new Map(
    navigationRepositories.map((repository) => [repository.root, structuredClone(repository)]),
  );
  const folderOf = (value) => (typeof value === "string" ? value.replace(/[\\/]+$/, "") : "");
  const repositoryAt = (value) => {
    const folder = folderOf(value);
    for (const repository of repositories.values()) {
      if (repository.branches.some((entry) => entry.worktreePath === folder))
        return { repository, isTopLevel: true, folder };
      if (repository.detached.some((entry) => entry.path === folder)) return { repository, isTopLevel: true, folder };
    }
    const exact = repositories.get(folder);
    if (exact) return { repository: exact, isTopLevel: true, folder };
    for (const repository of repositories.values()) {
      if (folder.startsWith(`${repository.root}/`)) return { repository, isTopLevel: false, folder };
    }
    return null;
  };
  const checkoutAt = (repository, folder) => {
    const branch = repository.branches.find((entry) => entry.worktreePath === folder);
    if (branch) return { branch };
    const detached = repository.detached.find((entry) => entry.path === folder);
    return detached ? { detached } : null;
  };
  const mainFolderBranch = (repository) =>
    repository.branches.find((entry) => entry.worktreePath === repository.mainFolder)?.name ?? null;
  const branchOfFolder = (repository, found) => {
    const checkout = checkoutAt(repository, found.folder);
    if (checkout?.branch) return checkout.branch.name;
    if (checkout?.detached) return null;
    return found.isTopLevel ? null : mainFolderBranch(repository);
  };
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
      listener({ cwd: detail.info.cwd, sessionId: detail.sessionId, session: structuredClone(detail.info) });
  };
  const state = { remainingPrepareFailures: personalPrepareFailures, sessionSequence: 0, skillWrites: 0 };
  const call = createNavigationHostMethods({
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
  });
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
    platform,
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
          requests.push({ method, params: structuredClone(params ?? null) });
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
    requests: (method) => requests.filter((entry) => entry.method === method).map((entry) => entry.params),
    rememberedSpace: () => uiState.lastSpaceCwd,
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
    releaseHolds() {
      holds.length = 0;
      for (const entry of allHolds) entry.released.resolve();
    },
    skillWrites: () => state.skillWrites,
    writeSkillFile(filePath, content) {
      if (!files.has(filePath)) throw new Error(`Fixture has no skill file ${filePath}`);
      files.set(filePath, content);
    },
    addConversation(detail) {
      details.push(detail);
    },
    replaceConversation(sessionId, detail) {
      const index = details.findIndex((item) => item.sessionId === sessionId);
      if (index < 0) throw new Error(`Fixture cannot replace unknown session ${sessionId}`);
      details[index] = detail;
    },
    appendTurn(sessionId, question, answer) {
      const detail = details.find((item) => item.sessionId === sessionId);
      if (!detail) throw new Error(`Fixture cannot append to unknown session ${sessionId}`);
      const added = detail.context.messages.length;
      detail.context.messages.push({ role: "user", content: question, timestamp: added + 1 }, assistantReply(answer));
      detail.context.entryIds.push(`${sessionId}-appended-${added}`, `${sessionId}-appended-${added + 1}`);
      detail.context.totalMessages = (detail.context.totalMessages ?? added) + 2;
      detail.context.loadedMessages = detail.context.messages.length;
      detail.context.historyRevision = `${sessionId}-revision-appended-${added + 2}`;
      detail.info.messageCount = (detail.info.messageCount ?? added) + 2;
      for (const listener of sessionChangedListeners)
        listener({ cwd: detail.info.cwd, sessionId: detail.sessionId, session: structuredClone(detail.info) });
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
