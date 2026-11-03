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
import { openCard, trigger, triggerName, says } from "../support/app-navigation-workspace.mjs";
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

test("when a new SSH workspace is read-only the composer trigger names the host and trust state while local labels stay unchanged", async (t) => {
  const scene = await remoteScene(t);
  await waitFor(() => assert.equal(triggerName(scene), "Workspace: app @prod-vps, branch main, read-only"));
  visibleText(trigger(scene), "@prod-vps");
  visibleText(trigger(scene), "Read-only");
  await emitState(scene, snapshot({ workspaceTrust: "trusted" }));
  assert.equal(triggerName(scene), "Workspace: app @prod-vps, branch main");
  assert.equal(roles(trigger(scene), "img", "Read-only").length, 0);
  await click(control(await scene.menu("app"), "menuitem", "Back to default space"));
  await waitFor(() => assert.equal(triggerName(scene), "Workspace: Default space"));
  assert.doesNotMatch(trigger(scene).textContent, /@prod-vps|Read-only/);
});

test("when the SSH workspace card opens it shows the host and remote path and keeps a live permission toggle without probing every remote project", async (t) => {
  const scene = await remoteScene(
    t,
    {},
    {
      "worktrees.branches": {
        projectRoot: REMOTE,
        isGit: true,
        isTopLevel: true,
        current: "main",
        mainFolder: REMOTE,
        branches: [
          {
            name: "main",
            isCurrent: true,
            committedAt: "2026-01-01",
            worktreePath: REMOTE,
            isMainFolder: true,
            stalePath: null,
          },
        ],
        detached: [],
      },
      "remote.trustSet": { state: snapshot() },
    },
  );
  const before = scene.external.requests("git.branch").filter((params) => params.path.startsWith("ssh://")).length;
  const menu = await openCard(scene);
  await scene.settled();
  visibleText(menu, "@prod-vps");
  visibleText(menu, "prod-vps:/home/ubuntu/app");
  says(
    menu,
    "Currently in safe read-only browsing. Local global skills are active; remote skills and long-running processes are deferred",
  );
  assert.equal(
    scene.external.requests("git.branch").filter((params) => params.path.startsWith("ssh://")).length,
    before,
  );
  await click(control(menu, "button", TRUST));
  await scene.settled();
  assert.deepEqual(scene.external.requests("remote.trustSet"), [{ workspace: REMOTE, trust: "trusted" }]);
  await emitState(scene, snapshot({ workspaceTrust: "trusted" }));
  visibleText(menu, "This remote repository is trusted");
  await click(control(menu, "button", SAFE));
  await scene.settled();
  assert.deepEqual(scene.external.requests("remote.trustSet").at(-1), { workspace: REMOTE, trust: "read-only" });
});

test("when an SSH conversation is bound to its folder the card shows its canonical address and cached offline branch with reconnect and trust controls", async (t) => {
  const scene = await remoteScene(
    t,
    { initialSession: "ssh-history" },
    {
      "remote.reconnect": { state: snapshot() },
      "remote.trustSet": ({ trust }) => ({ state: snapshot({ workspaceTrust: trust }) }),
    },
  );
  const menu = await openCard(scene);
  says(menu, REMOTE, "22ms online", "This session was created here. To work elsewhere, start a new session.");
  control(menu, "button", TRUST);
  await emitState(scene, snapshot({ connection: "offline", cachedBranch: "cached-release" }));
  says(menu, "offline", "cached-release");
  assert.equal(triggerName(scene), "Workspace: app @prod-vps, branch cached-release, read-only");
  await click(control(menu, "button", "Reconnect now"));
  await scene.settled();
  assert.deepEqual(scene.external.requests("remote.reconnect"), [{ workspace: REMOTE }]);
  says(menu, "22ms online");
  await click(control(menu, "button", TRUST));
  await scene.settled();
  control(menu, "button", SAFE);
  assert.equal(roles(menu, "button", "Show branches of app").length, 0);
});

test("when two remote projects have the same folder name the workspace card exposes host-qualified project and branch-browse controls", async (t) => {
  const staging = "ssh://deploy@staging-02/home/deploy/app";
  const scene = await remoteScene(t, { openProjects: [P.personal, REMOTE, staging] });
  const before = scene.external.requests("git.branch").filter((params) => params.path.startsWith("ssh://")).length;
  const menu = await openCard(scene);
  const projects = control(menu, "group", "Projects");
  control(projects, "button", "app @prod-vps");
  control(projects, "button", "app @staging-02");
  await click(control(projects, "button", "Show branches of app @staging-02"));
  await scene.settled();
  visibleText(menu, "staging-02:/home/deploy/app");
  assert.equal(
    scene.external.requests("git.branch").filter((params) => params.path.startsWith("ssh://")).length,
    before,
  );
});

test("when trusting or reconnecting a bound remote workspace fails the notice reports the failure and the workspace stays read-only and offline", async (t) => {
  const scene = await remoteScene(
    t,
    { initialSession: "ssh-history" },
    {
      "remote.workspacesSnapshot": { states: { [REMOTE]: snapshot({ connection: "offline", cachedBranch: "main" }) } },
      "remote.trustSet": new Error("Trust was denied"),
      "remote.reconnect": new Error("SSH is unavailable"),
    },
  );
  const menu = await openCard(scene);
  await click(control(menu, "button", TRUST));
  await scene.settled();
  visibleText(scene.container, "Could not update the remote workspace. Trust was denied");
  control(menu, "button", TRUST);
  assert.equal(triggerName(scene), "Workspace: app @prod-vps, branch main, read-only");
  await click(control(menu, "button", "Reconnect now"));
  await scene.settled();
  visibleText(scene.container, "Could not update the remote workspace. SSH is unavailable");
  visibleText(menu, "offline");
});
