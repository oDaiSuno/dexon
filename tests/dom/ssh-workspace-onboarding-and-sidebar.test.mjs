import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createDeferred } from "#test-timing";
import {
  startNavigation,
  control,
  roles,
  click,
  act,
  keyDown,
  waitFor,
  visibleText,
  dom,
  restoreGlobals,
} from "../support/app-navigation.mjs";
import { projectItem, projectMenu, projectOrder, enabledAction } from "../support/app-navigation-projects.mjs";
import { navigationBoundary } from "../fixtures/app-navigation-host.mjs";
import { navigationPaths as P, startedConversation } from "../fixtures/app-navigation-data.mjs";
import { remoteHostBoundary } from "../support/api-host.mjs";
import { accessibleName } from "../support/dom-queries.mjs";

after(restoreGlobals);

const REMOTE = "ssh://ubuntu@prod-vps/home/ubuntu/app";
const STAGING = "ssh://deploy@staging-02/home/deploy/app";
const DEXON = "/Users/navigation/Developer/dexon";
const REMOTE_NAME = "app @prod-vps";
const NEW_SESSION = "New session in this remote folder";
const COPY_ADDRESS = "Copy full SSH address";
const SYNC_RULES = "Re-sync remote AGENTS.md and skills";
const TRUST = "Trust this remote repository";
const READ_ONLY = "Switch to safe read-only browsing";
const DISCONNECT = "Disconnect and close this remote project (keep local history)";

function snapshot(workspace = REMOTE, patch = {}) {
  const staging = workspace === STAGING;
  return {
    workspace,
    hostLabel: staging ? "staging-02" : "prod-vps",
    authorityLabel: staging ? "deploy@staging-02" : "ubuntu@prod-vps",
    remotePath: staging ? "/home/deploy/app" : "/home/ubuntu/app",
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
      remoteAgentsMdPaths: ["/home/ubuntu/app/AGENTS.md"],
      remoteSkillCount: 2,
      ancestorBoundary: "git-root",
      boundaryPath: "/home/ubuntu/app",
      syncedAt: 1,
    },
    containment: { state: "verified-clean", activeRemoteProcessCount: 0 },
    ...patch,
  };
}

async function remoteScene(t, { states = { [REMOTE]: snapshot() }, ...options } = {}, script = {}) {
  const settings = { openProjects: [P.personal, REMOTE], ...options };
  const base = navigationBoundary(settings);
  const detail = startedConversation("ssh-history", REMOTE, "Remote history is saved locally");
  detail.info.name = "Remote order investigation";
  base.addConversation(detail);
  const external = remoteHostBoundary(base, {
    "remote.workspacesSnapshot": { states },
    "skills.list": (params) =>
      params?.cwd?.startsWith("ssh://") ? { skills: [] } : base.host.call("skills.list", params),
    ...script,
  });
  const scene = await startNavigation(t, settings, external);
  await scene.settled();
  return scene;
}

async function emitState(scene, state, transition) {
  await act(async () => scene.external.emitWorkspaceState({ workspace: state.workspace, state, transition }));
}

function clipboard(t) {
  const navigator = dom.window.navigator;
  const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const copied = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (value) => copied.push(value) },
  });
  t.after(() => {
    if (original) Object.defineProperty(navigator, "clipboard", original);
    else delete navigator.clipboard;
  });
  return copied;
}

test("when an SSH project is connected the sidebar shows its host capsule and a remote server icon", async (t) => {
  const scene = await remoteScene(t);
  const row = projectItem(scene, REMOTE_NAME);
  visibleText(row, "app");
  visibleText(row, "@prod-vps");
  control(row, "img", "Remote server");
  assert.equal(accessibleName(control(row, "button", REMOTE_NAME)), REMOTE_NAME);
});

test("when an SSH address encodes a folder character the sidebar shows the actual folder name", async (t) => {
  const scene = await remoteScene(t, {
    openProjects: [P.personal, "ssh://ubuntu@prod-vps/home/ubuntu/app%23review"],
    states: {},
  });
  const row = projectItem(scene, "app#review @prod-vps");
  visibleText(row, "app#review");
  visibleText(row, "@prod-vps · offline");
});

test("when an SSH connection is reconnecting the sidebar shows the amber reconnecting host capsule", async (t) => {
  const scene = await remoteScene(t, { states: { [REMOTE]: snapshot(REMOTE, { connection: "reconnecting" }) } });
  visibleText(projectItem(scene, REMOTE_NAME), "@prod-vps · reconnecting");
});

test("when an SSH project has no snapshot the sidebar shows an offline host capsule and offers read-only trust", async (t) => {
  const scene = await remoteScene(t, { states: {} });
  visibleText(projectItem(scene, REMOTE_NAME), "@prod-vps · offline");
  enabledAction(await projectMenu(scene, REMOTE_NAME), TRUST);
});

test("when an SSH connection changes the sidebar updates its capsule from connected through reconnecting to offline", async (t) => {
  const scene = await remoteScene(t);
  visibleText(projectItem(scene, REMOTE_NAME), "@prod-vps");
  await emitState(scene, snapshot(REMOTE, { connection: "reconnecting" }));
  visibleText(projectItem(scene, REMOTE_NAME), "@prod-vps · reconnecting");
  await emitState(scene, snapshot(REMOTE, { connection: "offline" }));
  visibleText(projectItem(scene, REMOTE_NAME), "@prod-vps · offline");
});

test("when an SSH project is offline it is not a missing local folder and its locally saved sessions remain readable", async (t) => {
  const scene = await remoteScene(t, {
    states: { [REMOTE]: snapshot(REMOTE, { connection: "offline" }) },
    unavailableSpaces: { [REMOTE]: "Server cannot be reached" },
  });
  const row = projectItem(scene, REMOTE_NAME);
  assert.doesNotMatch(row.textContent, /Folder not found/);
  assert.equal(
    scene.external.requests("system.validateCwd").some((params) => params.path === REMOTE),
    false,
  );
  await click(control(row, "button", REMOTE_NAME));
  const history = control(scene.history(), "button", "Remote order investigation");
  await click(history);
  await waitFor(() => visibleText(scene.container, "Remote history is saved locally"));
});

test("when two servers contain a folder called app the sidebar gives each row its own host-qualified name", async (t) => {
  const scene = await remoteScene(t, {
    openProjects: [P.personal, REMOTE, STAGING],
    states: { [REMOTE]: snapshot(), [STAGING]: snapshot(STAGING) },
  });
  assert.deepEqual(projectOrder(scene), ["Default space", REMOTE_NAME, "app @staging-02"]);
  visibleText(projectItem(scene, "app @staging-02"), "@staging-02");
  assert.equal(roles(scene.history(), "button", "app").length, 0);
});

test("when remote and local sessions need attention the pulse well shows app@prod-vps / and dexon /", async (t) => {
  const options = { openProjects: [P.personal, REMOTE, DEXON] };
  const base = navigationBoundary(options);
  for (const [id, folder] of [
    ["remote-active", REMOTE],
    ["local-active", DEXON],
  ]) {
    const detail = startedConversation(id, folder, id);
    detail.info.name = id;
    base.addConversation(detail);
  }
  const external = remoteHostBoundary(base, { "remote.workspacesSnapshot": { states: { [REMOTE]: snapshot() } } });
  const scene = await startNavigation(t, options, external);
  await scene.settled();
  await act(async () => external.running([], { "remote-active": "awaiting_input", "local-active": "awaiting_input" }));
  const well = control(scene.navigation(), "region", "Active sessions");
  visibleText(well, "app@prod-vps /");
  visibleText(well, "dexon /");
  visibleText(projectItem(scene, REMOTE_NAME), "app");
});

test("when the SSH project menu opens it offers remote actions instead of the local project actions", async (t) => {
  const scene = await remoteScene(t);
  const menu = await projectMenu(scene, REMOTE_NAME);
  assert.deepEqual(roles(menu, "menuitem").map(accessibleName), [
    NEW_SESSION,
    COPY_ADDRESS,
    SYNC_RULES,
    TRUST,
    DISCONNECT,
  ]);
});

test("when a new session is chosen from an SSH project menu the composer moves to that remote folder", async (t) => {
  const scene = await remoteScene(t);
  await click(enabledAction(await projectMenu(scene, REMOTE_NAME), NEW_SESSION));
  await waitFor(async () => assert.equal(await scene.currentFolder(), REMOTE));
  control(control(scene.container, "region", "Chat"), "textbox");
});

test("when the full SSH address is copied from the project menu the clipboard receives its canonical address", async (t) => {
  const copied = clipboard(t);
  const scene = await remoteScene(t);
  await click(enabledAction(await projectMenu(scene, REMOTE_NAME), COPY_ADDRESS));
  await waitFor(() => assert.deepEqual(copied, [REMOTE]));
});

test("when trust is toggled in the SSH project menu the host receives the selected mode and the menu reverses its label", async (t) => {
  const scene = await remoteScene(
    t,
    {},
    {
      "remote.trustSet": ({ trust }) => ({ state: snapshot(REMOTE, { workspaceTrust: trust }) }),
    },
  );
  await click(enabledAction(await projectMenu(scene, REMOTE_NAME), TRUST));
  await scene.settled();
  assert.deepEqual(scene.external.requests("remote.trustSet"), [{ workspace: REMOTE, trust: "trusted" }]);
  await click(enabledAction(await projectMenu(scene, REMOTE_NAME), READ_ONLY));
  await scene.settled();
  assert.deepEqual(scene.external.requests("remote.trustSet"), [
    { workspace: REMOTE, trust: "trusted" },
    { workspace: REMOTE, trust: "read-only" },
  ]);
  enabledAction(await projectMenu(scene, REMOTE_NAME), TRUST);
});

test("when remote rules are re-synced from the SSH menu the host receives the workspace address", async (t) => {
  const scene = await remoteScene(t, {}, { "remote.syncRules": { state: snapshot() } });
  await click(enabledAction(await projectMenu(scene, REMOTE_NAME), SYNC_RULES));
  await scene.settled();
  assert.deepEqual(scene.external.requests("remote.syncRules"), [{ workspace: REMOTE }]);
});

test("when an SSH project is disconnected it closes only after the host confirms and its history can be reopened", async (t) => {
  const disconnect = createDeferred();
  t.after(() => disconnect.resolve({ state: snapshot(REMOTE, { connection: "offline" }) }));
  const scene = await remoteScene(t, {}, { "remote.disconnect": () => disconnect.promise });
  await click(enabledAction(await projectMenu(scene, REMOTE_NAME), DISCONNECT));
  await waitFor(() => assert.equal(scene.external.requests("remote.disconnect").length, 1));
  projectItem(scene, REMOTE_NAME);
  await act(async () => disconnect.resolve({ state: snapshot(REMOTE, { connection: "offline" }) }));
  await scene.settled();
  assert.deepEqual(projectOrder(scene), ["Default space"]);
  assert.deepEqual(scene.external.requests("sessions.delete"), []);
  await act(async () => scene.external.deepLink("ssh-history"));
  await waitFor(() => visibleText(scene.container, "Remote history is saved locally"));
});

test("when another project is closed while SSH disconnect is pending the completed disconnect does not restore that project", async (t) => {
  const disconnect = createDeferred();
  t.after(() => disconnect.resolve({ state: snapshot(REMOTE, { connection: "offline" }) }));
  const scene = await remoteScene(
    t,
    { openProjects: [P.personal, REMOTE, P.project, P.empty] },
    {
      "remote.disconnect": () => disconnect.promise,
    },
  );
  await click(enabledAction(await projectMenu(scene, REMOTE_NAME), DISCONNECT));
  await waitFor(() => assert.equal(scene.external.requests("remote.disconnect").length, 1));
  await click(enabledAction(await projectMenu(scene, "navigation-project"), "Close project"));
  assert.deepEqual(projectOrder(scene), ["Default space", REMOTE_NAME, "empty-project"]);
  await act(async () => disconnect.resolve({ state: snapshot(REMOTE, { connection: "offline" }) }));
  await scene.settled();
  assert.deepEqual(projectOrder(scene), ["Default space", "empty-project"]);
});

test("when a local project menu opens beside an SSH project its names and move and close behavior remain unchanged", async (t) => {
  const scene = await remoteScene(t, { openProjects: [P.personal, P.project, P.empty, REMOTE] });
  const menu = await projectMenu(scene, "navigation-project");
  assert.deepEqual(roles(menu, "menuitem").map(accessibleName), ["Move up", "Move down", "Close project"]);
  await click(enabledAction(menu, "Move down"));
  assert.deepEqual(projectOrder(scene), ["Default space", "empty-project", "navigation-project", REMOTE_NAME]);
  await click(enabledAction(await projectMenu(scene, "navigation-project"), "Close project"));
  assert.deepEqual(projectOrder(scene), ["Default space", "empty-project", REMOTE_NAME]);
});

test("when an SSH workspace becomes trusted its toast offers Undo and disappears after about four seconds", async (t) => {
  const scene = await remoteScene(
    t,
    {},
    {
      "remote.trustSet": ({ trust }) => ({ state: snapshot(REMOTE, { workspaceTrust: trust }) }),
    },
  );
  const trusted = snapshot(REMOTE, { workspaceTrust: "trusted" });
  await emitState(scene, trusted, "trusted");
  visibleText(scene.container, "Trusted app @prod-vps. 2 remote skills enabled");
  await click(control(scene.container, "button", "Undo"));
  await scene.settled();
  assert.deepEqual(scene.external.requests("remote.trustSet"), [{ workspace: REMOTE, trust: "read-only" }]);
  await act(async () => new Promise((resolve) => setTimeout(resolve, 3_600)));
  visibleText(scene.container, "Trusted app @prod-vps. 2 remote skills enabled");
  await waitFor(
    () => {
      assert.doesNotMatch(scene.container.textContent, /Trusted app @prod-vps\. 2 remote skills enabled/);
      assert.equal(roles(scene.container, "button", "Undo").length, 0);
    },
    { timeout: 1_200 },
  );
});

test("when SSH reconnects cleanly its toast confirms that the previous remote processes were cleaned up", async (t) => {
  const scene = await remoteScene(t);
  await emitState(scene, snapshot(), "reconnected-clean");
  visibleText(
    scene.container,
    "Reconnected to prod-vps. Remote processes from before the disconnect were confirmed clean",
  );
});

test("when the app is in Chinese the SSH sidebar capsule and menu use the reviewed Chinese wording", async (t) => {
  const scene = await remoteScene(t, {
    language: "zh-CN",
    states: { [REMOTE]: snapshot(REMOTE, { connection: "offline" }) },
  });
  visibleText(projectItem(scene, REMOTE_NAME), "@prod-vps · 离线");
  const menu = await projectMenu(scene, REMOTE_NAME);
  assert.deepEqual(roles(menu, "menuitem").map(accessibleName), [
    "在此远端目录新建会话",
    "复制 SSH 完整地址",
    "重新同步远端 AGENTS.md 与技能",
    "信任此远端仓库",
    "断开并关闭此远程项目（保留本机历史）",
  ]);
  await keyDown(menu, "Escape");
});
