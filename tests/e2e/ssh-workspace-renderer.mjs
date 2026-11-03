import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../../src/renderer/App.tsx";
import { setAppLanguage } from "../../src/renderer/i18n.ts";
import { resetRpc } from "../../src/renderer/lib/api-client.ts";
import { installApiShims } from "../../src/renderer/lib/api-fetch.ts";
import { installRendererApi } from "../support/renderer-api.mjs";
import { navigationBoundary } from "../fixtures/app-navigation-host.mjs";
import { navigationPaths as P, startedConversation } from "../fixtures/app-navigation-data.mjs";
import { remoteHostBoundary } from "../support/api-host.mjs";
import { accessibleName, allByRole, getByRole } from "../support/dom-queries.mjs";
import "./production-styles.mjs";

const window = globalThis.window;
const document = globalThis.document;

const REMOTE = "ssh://ubuntu@prod-vps/home/ubuntu/work/app";
const FILE_CONTENT = "export const poolSize = 14;";
const ROOT = "/home/ubuntu/work";
const SOURCE = "http://localhost:3000/";
const LOCAL_URL = "http://127.0.0.1:54321/";

function snapshot(patch = {}) {
  return {
    workspace: REMOTE,
    hostLabel: "prod-vps",
    authorityLabel: "ubuntu@prod-vps",
    remotePath: "/home/ubuntu/work/app",
    connection: "connected",
    rttMs: 22,
    workspaceTrust: "read-only",
    trustRevision: 1,
    remoteSkillCount: 2,
    localSkillCount: 12,
    ruleLens: {
      localAgentsMd: true,
      localSkillCount: 12,
      credentialsBlocked: true,
      remoteAgentsMdPaths: ["/home/ubuntu/work/app/AGENTS.md"],
      remoteSkillCount: 2,
      ancestorBoundary: "git-root",
      boundaryPath: "/home/ubuntu/work/app",
      syncedAt: 1,
    },
    containment: { state: "verified-clean", activeRemoteProcessCount: 0 },
    ...patch,
  };
}

function processInfo(endpointViews) {
  return {
    processId: "ssh-server",
    runId: "ssh-run",
    generation: 1,
    label: "Remote app server",
    kind: "server",
    state: "ready",
    readiness: "ready",
    ownerSessionId: "ssh-ops",
    cwdDisplay: REMOTE,
    workspaceKey: REMOTE,
    commandDisplay: "npm run dev",
    createdAt: 1,
    stdinOpen: false,
    endpoints: [{ id: "remote-http", url: SOURCE, source: "stdout", firstSeenAt: 1, lastSeenAt: 1, runId: "ssh-run" }],
    endpointViews,
    watchdogLeaseMs: 15000,
    networkWarnings: [],
    restartCount: 0,
    output: {
      earliestCursor: "ssh-run:0",
      latestCursor: "ssh-run:0",
      retainedBytes: 0,
      droppedBytes: 0,
      droppedRecords: 0,
    },
  };
}

const settings = { history: false, lastSpaceCwd: REMOTE, openProjects: [P.personal, REMOTE] };
const base = navigationBoundary(settings);

const sshSession = startedConversation("ssh-ops", REMOTE, "Investigate prod");
sshSession.info.name = "Investigate prod";
base.addConversation(sshSession);

const localSession = startedConversation("local-ops", P.personal, "Local task");
localSession.info.name = "Local task";
base.addConversation(localSession);

let currentProcess = null;
let processRevision = 0;

const external = remoteHostBoundary(base, {
  "remote.workspacesSnapshot": { states: { [REMOTE]: snapshot() } },
  "remote.hosts": {
    hosts: [
      {
        alias: "prod-vps",
        host: "prod-vps",
        user: "ubuntu",
        port: 22,
        identityReady: true,
        source: "ssh-config",
        lastOpenedPath: ROOT,
      },
    ],
  },
  "remote.browse": (params) => {
    const browsePath = params.path ?? ROOT;
    return {
      status: "ready",
      target: params.target ?? { user: "ubuntu", host: "prod-vps", port: 22 },
      currentPath: browsePath,
      remoteHome: "/home/ubuntu",
      rttMs: 22,
      entries:
        browsePath === ROOT
          ? [
              { name: "app", path: `${ROOT}/app`, isGitRepo: true, gitBranch: "main" },
              { name: "billing", path: `${ROOT}/billing`, isGitRepo: true, gitBranch: "feat/invoices" },
              { name: "datasets", path: `${ROOT}/datasets`, isGitRepo: false },
            ]
          : [],
    };
  },
  "remote.trustSet": (params) => {
    const newState = snapshot({ workspaceTrust: params.trust });
    setTimeout(() => external.emitWorkspaceState({ workspace: REMOTE, state: newState }), 30);
    return { state: newState };
  },
  "remote.trustPromptResolve": (params) => {
    const newState = snapshot({ workspaceTrust: params.decision === "trust" ? "trusted" : "read-only" });
    setTimeout(() => external.emitWorkspaceState({ workspace: REMOTE, state: newState }), 30);
    return { state: newState };
  },
  "remote.syncRules": { state: snapshot() },
  "remote.disconnect": { state: snapshot({ connection: "offline" }) },
  "remote.acceptHostKey": { ok: true },
  "system.validateCwd": (params) =>
    params.path.startsWith("ssh://") ? { ok: true, path: params.path } : base.host.call("system.validateCwd", params),
  "skills.list": (params) =>
    params?.cwd?.startsWith("ssh://") ? { skills: [] } : base.host.call("skills.list", params),
  "git.branch": (params) =>
    params.path === REMOTE ? { isGit: true, branch: "main" } : base.host.call("git.branch", params),
  "worktrees.list": (params) =>
    params.projectRoot === REMOTE
      ? {
          projectRoot: REMOTE,
          isGit: true,
          isTopLevel: true,
          worktrees: [{ path: REMOTE, branch: "main", isMain: true }],
        }
      : base.host.call("worktrees.list", params),
  "processes.list": () => ({ revision: processRevision, processes: currentProcess ? [currentProcess] : [] }),
  "processes.read": {
    processId: "ssh-server",
    runId: "ssh-run",
    state: "ready",
    readiness: "ready",
    endpoints: [],
    fromCursor: "ssh-run:0",
    nextCursor: "ssh-run:0",
    earliestCursor: "ssh-run:0",
    records: [],
    truncated: false,
  },
  "files.list": (params) => {
    const tree = {
      [REMOTE]: [{ name: "src", type: "directory", isDir: true }],
      [`${REMOTE}/src`]: [{ name: "db", type: "directory", isDir: true }],
      [`${REMOTE}/src/db`]: [{ name: "pool.ts", type: "file", isDir: false }],
    };
    return { entries: tree[params.path] ?? [] };
  },
  "files.read": () => ({
    content: FILE_CONTENT,
    language: "typescript",
    size: FILE_CONTENT.length,
    space: "remote",
    remoteHostLabel: "prod-vps",
  }),
  "files.watchStart": (params) => {
    external.emitFileEvent({ path: params.path, event: "connected" });
    return { ok: true };
  },
});

const boundary = installRendererApi(window, { installApiShims, resetRpc }, () => external.host, {
  bridge: external.bridge,
});

setAppLanguage("en-US");

const root = createRoot(document.getElementById("root"));
root.render(createElement(App));

window.sshProof = {
  ready() {
    return external.runningSubscribers() > 0 && allByRole(document, "navigation", "Main navigation").length > 0;
  },

  start() {
    external.running(["ssh-ops"], { "ssh-ops": "running" });
  },

  find(role, name) {
    return getByRole(document, role, typeof name === "string" ? name : new RegExp(name.pattern));
  },

  exists(role, name) {
    return allByRole(document, role, typeof name === "string" ? name : new RegExp(name.pattern)).length > 0;
  },

  disconnectNotices() {
    return allByRole(document, "alert").filter((node) => node.dataset.testid === "ssh-workspace-disconnect").length;
  },

  names(role) {
    return allByRole(document, role).map(accessibleName);
  },

  height(role, name) {
    return Math.round(getByRole(document, role, name).getBoundingClientRect().height);
  },

  hasText(text) {
    return document.body.textContent.includes(text);
  },

  triggerSwitcher() {
    external.menu("open-project-switcher");
  },

  typeIn(role, name, text) {
    const el = getByRole(document, role, name);
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    setter?.call(el, text);
    el.dispatchEvent(new window.InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  },

  setProcess(kind) {
    if (kind === "mapping") {
      currentProcess = processInfo([
        { id: "remote-http", state: "mapping", sourceUrl: SOURCE, remoteHostLabel: "prod-vps", remotePort: 3000 },
      ]);
    } else if (kind === "available") {
      currentProcess = processInfo([
        {
          id: "remote-http",
          state: "available",
          sourceUrl: SOURCE,
          openUrl: LOCAL_URL,
          localPort: 54321,
          portShifted: true,
          remoteHostLabel: "prod-vps",
          remotePort: 3000,
        },
      ]);
    } else {
      currentProcess = null;
    }
    processRevision++;
    external.emitProcessesChanged({
      revision: processRevision,
      processId: "ssh-server",
      runId: "ssh-run",
      reason: "state",
    });
  },

  openProcesses() {
    external.menu("open-processes");
  },

  emitDisconnect() {
    external.emitWorkspaceState({
      workspace: REMOTE,
      state: snapshot({ connection: "offline", containment: { state: "pending", activeRemoteProcessCount: 1 } }),
    });
  },

  emitTrustPrompt() {
    external.emitTrustPrompt({
      promptId: "run-dev",
      workspace: REMOTE,
      sessionId: "ssh-ops",
      status: "pending",
      kind: "process_start",
      command: "npm run dev -- --host 127.0.0.1",
      cwd: "/home/ubuntu/work/app",
      remoteHostLabel: "prod-vps",
      remoteSkillCount: 2,
    });
  },

  openSession(id) {
    external.deepLink(id);
  },

  unexpected: () => external.unexpected,

  close() {
    root.unmount();
    boundary.close();
    external.releaseHolds();
  },
};
