import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  act,
  click,
  control,
  roles,
  startNavigation,
  visibleText,
  waitFor,
  restoreGlobals,
} from "../support/app-navigation.mjs";
import { keyDown, mouseDown, dom } from "../support/app-navigation.mjs";
import { navigationBoundary } from "../fixtures/app-navigation-host.mjs";
import { navigationPaths as P, startedConversation } from "../fixtures/app-navigation-data.mjs";
import { remoteHostBoundary } from "../support/api-host.mjs";
import { projectMenu } from "../support/app-navigation-projects.mjs";

after(restoreGlobals);

const REMOTE = "ssh://ubuntu@prod-vps/home/ubuntu/app";
const TRUST = "Trust this remote repository";
const SAFE = "Switch to safe read-only";

function snapshot(patch = {}) {
  return {
    workspace: REMOTE,
    hostLabel: "prod-vps",
    authorityLabel: "ubuntu@prod-vps",
    remotePath: "/home/ubuntu/app",
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

async function remoteScene(t, options = {}, script = {}) {
  const settings = { history: false, lastSpaceCwd: REMOTE, openProjects: [P.personal, REMOTE], ...options };
  const base = navigationBoundary(settings);
  const detail = startedConversation("ssh-history", REMOTE, "Remote history is saved locally");
  detail.info.name = "Remote order investigation";
  base.addConversation(detail);
  const external = remoteHostBoundary(base, {
    "remote.workspacesSnapshot": { states: { [REMOTE]: snapshot() } },
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
    ...script,
  });
  const scene = await startNavigation(t, settings, external);
  await scene.settled();
  if (!settings.initialSession) {
    await click(control(await projectMenu(scene, "app @prod-vps"), "menuitem", "New session in this remote folder"));
    await waitFor(async () => assert.equal(await scene.currentFolder(), REMOTE));
  }
  return scene;
}

async function emitState(scene, state) {
  await act(async () => scene.external.emitWorkspaceState({ workspace: state.workspace, state }));
}

test("when the SSH connection pill opens the rule lens it explains both spaces and credentials, supports re-sync and trust, and returns focus on Escape", async (t) => {
  const scene = await remoteScene(
    t,
    {},
    {
      "remote.syncRules": { state: snapshot() },
      "remote.trustSet": ({ trust }) => ({ state: snapshot({ workspaceTrust: trust }) }),
    },
  );
  const pill = control(scene.container, "button", "SSH connected · 22ms");
  await click(pill);
  const lens = control(dom.window.document.body, "dialog", "Dual-space environment and rule lens");
  visibleText(lens, "Dual-space environment and rule lens");
  visibleText(lens, REMOTE);
  visibleText(lens, "Local overlay layer");
  visibleText(lens, "~/.pi/agent/AGENTS.md");
  visibleText(lens, "~/.pi/agent/skills (12 mounted)");
  visibleText(lens, "~/.pi/agent/auth.json and models.json are strictly blocked for remote sessions");
  visibleText(lens, "Remote project mirror layer");
  visibleText(lens, "/home/ubuntu/app/AGENTS.md");
  visibleText(lens, "Project skills: 2 deferred");
  visibleText(lens, "Rule lookup stops at the remote Git repository root (/home/ubuntu/app)");
  await click(control(lens, "button", "↻ Re-sync remote rules"));
  await scene.settled();
  assert.deepEqual(scene.external.requests("remote.syncRules"), [{ workspace: REMOTE }]);
  await click(control(lens, "button", TRUST));
  await scene.settled();
  visibleText(lens, "Project skills: 2 enabled");
  await click(control(lens, "button", SAFE));
  await scene.settled();
  assert.deepEqual(scene.external.requests("remote.trustSet").at(-1), { workspace: REMOTE, trust: "read-only" });
  await keyDown(lens, "Escape");
  assert.equal(roles(dom.window.document.body, "dialog", "Dual-space environment and rule lens").length, 0);
  assert.equal(dom.window.document.activeElement, pill);
  await click(pill);
  await mouseDown(control(scene.container, "region", "Chat"));
  assert.equal(roles(dom.window.document.body, "dialog", "Dual-space environment and rule lens").length, 0);
  assert.equal(dom.window.document.activeElement, pill);
});

test("when the server reconnects or goes offline the pill follows its connection state and the lens reports the remote-home rule boundary", async (t) => {
  const scene = await remoteScene(t);
  await emitState(scene, snapshot({ connection: "reconnecting" }));
  control(scene.container, "button", "SSH reconnecting…");
  const state = snapshot({
    connection: "offline",
    ruleLens: {
      ...snapshot().ruleLens,
      localAgentsMd: false,
      remoteAgentsMdPaths: [],
      ancestorBoundary: "remote-home",
      boundaryPath: "/home/ubuntu",
      syncedAt: null,
    },
  });
  await emitState(scene, state);
  await click(control(scene.container, "button", "SSH offline"));
  const lens = control(dom.window.document.body, "dialog", "Dual-space environment and rule lens");
  visibleText(lens, "Rule lookup stops at the remote home directory (/home/ubuntu)");
  visibleText(lens, "No AGENTS.md found");
  assert.doesNotMatch(lens.textContent, /~\/.pi\/agent\/AGENTS.md/);
  visibleText(lens, "~/.pi/agent/auth.json and models.json are strictly blocked for remote sessions");
});

test("when a remote session is opened on a narrow screen its connection pill still opens the complete rule lens", async (t) => {
  const scene = await remoteScene(t, { initialSession: "ssh-history", viewport: "narrow" });
  await click(control(scene.container, "button", "SSH connected · 22ms"));
  const lens = control(dom.window.document.body, "dialog", "Dual-space environment and rule lens");
  visibleText(lens, REMOTE);
  control(lens, "button", "↻ Re-sync remote rules");
  control(lens, "button", TRUST);
  await keyDown(lens, "Escape");
  control(scene.container, "button", "SSH connected · 22ms");
});

test("when re-syncing remote rules fails the lens remains open and reports the failure", async (t) => {
  const scene = await remoteScene(t, {}, { "remote.syncRules": new Error("Rule mirror is unavailable") });
  await click(control(scene.container, "button", "SSH connected · 22ms"));
  const lens = control(dom.window.document.body, "dialog", "Dual-space environment and rule lens");
  await click(control(lens, "button", "↻ Re-sync remote rules"));
  await scene.settled();
  visibleText(scene.container, "Could not update the remote workspace. Rule mirror is unavailable");
  control(dom.window.document.body, "dialog", "Dual-space environment and rule lens");
});
