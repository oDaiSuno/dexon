import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  act,
  click,
  control,
  dom,
  roles,
  startNavigation,
  visibleText,
  waitFor,
  restoreGlobals,
} from "../support/app-navigation.mjs";
import { navigationBoundary } from "../fixtures/app-navigation-host.mjs";
import { navigationPaths as P, startedConversation } from "../fixtures/app-navigation-data.mjs";
import { remoteHostBoundary } from "../support/api-host.mjs";

after(restoreGlobals);

const REMOTE = "ssh://ubuntu@prod-vps/home/ubuntu/work/app";
const OTHER = "ssh://deploy@staging/home/deploy/api";
const LOST = "Connection lost to prod-vps";
const SAVED = "Your history and draft are saved on this computer";
const DRAFT = "Keep this unfinished investigation on this computer";

function snapshot(patch = {}) {
  return {
    workspace: REMOTE,
    hostLabel: "prod-vps",
    authorityLabel: "ubuntu@prod-vps",
    remotePath: "/home/ubuntu/work/app",
    connection: "connected",
    workspaceTrust: "trusted",
    trustRevision: 1,
    remoteSkillCount: 2,
    localSkillCount: 12,
    ruleLens: {
      localAgentsMd: true,
      localSkillCount: 12,
      credentialsBlocked: true,
      remoteAgentsMdPaths: [],
      remoteSkillCount: 2,
      ancestorBoundary: "git-root",
      boundaryPath: "/home/ubuntu/work/app",
      syncedAt: 1,
    },
    containment: { state: "verified-clean", activeRemoteProcessCount: 0 },
    ...patch,
  };
}

async function disconnectScene(t, state = snapshot(), script = {}) {
  const settings = { history: false, initialSession: "ssh-ops", openProjects: [P.personal, P.project, REMOTE, OTHER] };
  const base = navigationBoundary(settings);
  for (const [id, cwd, question] of [
    ["ssh-ops", REMOTE, "Investigate production"],
    ["local-ops", P.project, "Continue local work"],
    ["ssh-good", OTHER, "Continue staging work"],
  ])
    base.addConversation(startedConversation(id, cwd, question));
  const external = remoteHostBoundary(base, {
    "remote.workspacesSnapshot": {
      states: {
        [REMOTE]: state,
        [OTHER]: snapshot({
          workspace: OTHER,
          hostLabel: "staging",
          authorityLabel: "deploy@staging",
          remotePath: "/home/deploy/api",
        }),
      },
    },
    "skills.list": { skills: [] },
    ...script,
  });
  const scene = await startNavigation(t, settings, external);
  await scene.settled();
  return scene;
}

function includesText(root, value) {
  assert.ok(root.textContent.includes(value), `Expected visible message to include: ${value}`);
}

function banners(scene) {
  return roles(scene.container, "alert").filter((node) => node.dataset.testid === "ssh-workspace-disconnect");
}

function banner(scene) {
  const shown = banners(scene);
  assert.equal(shown.length, 1, "one disconnect notice is visible above the current composer");
  return shown[0];
}

const composer = (scene) => control(control(scene.container, "region", "Chat"), "textbox");

async function writeDraft(scene, text) {
  const editor = composer(scene);
  await act(async () => {
    editor.focus();
    editor.textContent = text;
    editor.dispatchEvent(new dom.window.InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  });
}

async function emitState(scene, state) {
  await act(async () => scene.external.emitWorkspaceState({ workspace: state.workspace, state }));
}

test("when the current SSH connection drops its warning names the host and watchdog count and reconnect restores it without touching the draft", async (t) => {
  const scene = await disconnectScene(t, snapshot(), { "remote.reconnect": { state: snapshot() } });
  await writeDraft(scene, DRAFT);
  await emitState(
    scene,
    snapshot({ connection: "offline", containment: { state: "pending", activeRemoteProcessCount: 2 } }),
  );
  const notice = banner(scene);
  includesText(notice, LOST);
  includesText(notice, "2 remote processes are being reclaimed by the 15s watchdog");
  includesText(notice, SAVED);
  assert.equal(composer(scene).textContent, DRAFT);
  await click(control(notice, "button", "Reconnect now"));
  await scene.settled();
  assert.deepEqual(scene.external.requests("remote.reconnect"), [{ workspace: REMOTE }]);
  assert.equal(banners(scene).length, 0);
  assert.equal(composer(scene).textContent, DRAFT);
});

test("when SSH is retrying with no remote process the warning shows the real attempt counts and omits the watchdog claim", async (t) => {
  const scene = await disconnectScene(
    t,
    snapshot({ connection: "reconnecting", reconnectAttempt: 2, maxReconnectAttempts: 5 }),
  );
  includesText(banner(scene), LOST);
  includesText(banner(scene), "retrying 2/5");
  includesText(banner(scene), SAVED);
  assert.doesNotMatch(banner(scene).textContent, /watchdog|being reclaimed/);
  control(banner(scene), "button", "Reconnect now");
});

test("when SSH is connected but containment is pending the watchdog warning remains until a verified-clean push arrives", async (t) => {
  const scene = await disconnectScene(t, snapshot({ containment: { state: "pending", activeRemoteProcessCount: 1 } }));
  includesText(banner(scene), "1 remote processes are being reclaimed by the 15s watchdog");
  await emitState(scene, snapshot());
  assert.equal(banners(scene).length, 0);
});

test("when containment finds a leaked group the error limits its pause to this remote workspace and cleanup targets only that workspace", async (t) => {
  const scene = await disconnectScene(
    t,
    snapshot({ containment: { state: "verified-leak", activeRemoteProcessCount: 1, leakedPgid: 4312 } }),
    { "remote.cleanupRetry": { state: snapshot() } },
  );
  const notice = banner(scene);
  includesText(notice, "Process group #4312 did not stop; only new services in this remote workspace are paused");
  assert.equal(roles(notice, "button", "Reconnect now").length, 0);
  await click(control(notice, "button", "Clean up again"));
  await scene.settled();
  assert.deepEqual(scene.external.requests("remote.cleanupRetry"), [{ workspace: REMOTE }]);
  assert.equal(banners(scene).length, 0);
});

test("when a disconnect notice is dismissed it stays closed for the same state and returns for a changed retry leak or new outage", async (t) => {
  const offline = snapshot({ connection: "reconnecting", reconnectAttempt: 1, maxReconnectAttempts: 5 });
  const scene = await disconnectScene(t, offline);
  await click(control(banner(scene), "button", "Dismiss remote connection notice"));
  await emitState(scene, { ...offline });
  assert.equal(banners(scene).length, 0);
  await emitState(scene, snapshot({ connection: "reconnecting", reconnectAttempt: 2, maxReconnectAttempts: 5 }));
  includesText(banner(scene), "retrying 2/5");
  await click(control(banner(scene), "button", "Dismiss remote connection notice"));
  await emitState(
    scene,
    snapshot({ containment: { state: "verified-leak", activeRemoteProcessCount: 1, leakedPgid: 4312 } }),
  );
  control(banner(scene), "button", "Clean up again");
  await emitState(scene, snapshot());
  assert.equal(banners(scene).length, 0);
  await emitState(scene, offline);
  includesText(banner(scene), "retrying 1/5");
});

test("when one SSH workspace is offline switching to a local or healthy SSH session removes its notice and each conversation keeps its own usable draft", async (t) => {
  const scene = await disconnectScene(t);
  await writeDraft(scene, DRAFT);
  await emitState(
    scene,
    snapshot({ connection: "offline", containment: { state: "pending", activeRemoteProcessCount: 2 } }),
  );
  includesText(banner(scene), LOST);
  await act(async () => scene.external.deepLink("local-ops"));
  await waitFor(() => visibleText(scene.container, "Continue local work"));
  assert.equal(banners(scene).length, 0);
  await writeDraft(scene, "Send this local task while production is offline");
  assert.equal(control(scene.container, "button", "Send").disabled, false);
  await click(control(scene.container, "button", "Send"));
  await scene.settled();
  assert.deepEqual(scene.external.prompts().at(-1), {
    sessionId: "local-ops",
    message: "Send this local task while production is offline",
  });
  await act(async () => scene.external.deepLink("ssh-good"));
  await waitFor(() => visibleText(scene.container, "Continue staging work"));
  assert.equal(banners(scene).length, 0);
  await writeDraft(scene, "Staging is still usable");
  assert.equal(control(scene.container, "button", "Send").disabled, false);
  await act(async () => scene.external.deepLink("ssh-ops"));
  await waitFor(() => visibleText(scene.container, "Investigate production"));
  includesText(banner(scene), LOST);
  assert.equal(composer(scene).textContent, DRAFT);
});

for (const [method, action, state] of [
  ["remote.reconnect", "Reconnect now", snapshot({ connection: "offline" })],
  [
    "remote.cleanupRetry",
    "Clean up again",
    snapshot({ containment: { state: "verified-leak", activeRemoteProcessCount: 1, leakedPgid: 4312 } }),
  ],
]) {
  test(`when ${action} fails the failure is reported and the notice and draft remain intact`, async (t) => {
    const scene = await disconnectScene(t, state, { [method]: new Error("SSH operation was denied") });
    await writeDraft(scene, DRAFT);
    await click(control(banner(scene), "button", action));
    await scene.settled();
    visibleText(scene.container, "Could not update the remote workspace. SSH operation was denied");
    control(banner(scene), "button", action);
    assert.deepEqual(scene.external.requests(method), [{ workspace: REMOTE }]);
    assert.equal(composer(scene).textContent, DRAFT);
  });
}
