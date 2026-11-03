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
import { openCard, triggerName } from "../support/app-navigation-workspace.mjs";
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

test("when the active remote workspace is read-only its inline banner can be dismissed without losing the card trust action or the pill lock", async (t) => {
  const scene = await remoteScene(
    t,
    {},
    { "remote.trustSet": ({ trust }) => ({ state: snapshot({ workspaceTrust: trust }) }) },
  );
  const banner = control(scene.container, "status", "Safe read-only browsing");
  visibleText(
    banner,
    "Safe read-only browsing: you can read code and use your local skills; remote repo skills and long-running processes are deferred until you trust this repository",
  );
  await click(control(banner, "button", "Dismiss read-only notice"));
  assert.equal(roles(scene.container, "status", "Safe read-only browsing").length, 0);
  control(scene.container, "button", "SSH connected · 22ms, read-only");
  const menu = await openCard(scene);
  await click(control(menu, "button", TRUST));
  await scene.settled();
  assert.deepEqual(scene.external.requests("remote.trustSet"), [{ workspace: REMOTE, trust: "trusted" }]);
  control(menu, "button", SAFE);
});

test("when the composer switches to a local project the SSH banner and pill disappear and a dismissed remote banner stays dismissed on return", async (t) => {
  const scene = await remoteScene(t);
  await click(
    control(control(scene.container, "status", "Safe read-only browsing"), "button", "Dismiss read-only notice"),
  );
  await click(control(await scene.menu("app"), "menuitem", "Back to default space"));
  await waitFor(() => assert.equal(triggerName(scene), "Workspace: Default space"));
  assert.equal(roles(scene.container, "status", "Safe read-only browsing").length, 0);
  assert.equal(roles(scene.container, "button", "SSH connected · 22ms, read-only").length, 0);
  await emitState(scene, snapshot());
  assert.equal(roles(scene.container, "status", "Safe read-only browsing").length, 0);
  await click(control(await projectMenu(scene, "app @prod-vps"), "menuitem", "New session in this remote folder"));
  await waitFor(() => assert.match(triggerName(scene), /@prod-vps/));
  assert.equal(roles(scene.container, "status", "Safe read-only browsing").length, 0);
  control(scene.container, "button", "SSH connected · 22ms, read-only");
});

test("when trust is granted from the inline notice it updates only the active SSH repository and hides the read-only banner", async (t) => {
  const scene = await remoteScene(
    t,
    {},
    { "remote.trustSet": ({ trust }) => ({ state: snapshot({ workspaceTrust: trust }) }) },
  );
  await click(control(control(scene.container, "status", "Safe read-only browsing"), "button", TRUST));
  await scene.settled();
  assert.deepEqual(scene.external.requests("remote.trustSet"), [{ workspace: REMOTE, trust: "trusted" }]);
  assert.equal(roles(scene.container, "status", "Safe read-only browsing").length, 0);
  control(scene.container, "button", "SSH connected · 22ms");
});

test("when a pending execution prompt matches this conversation it replaces the passive notice and either decision reaches the host", async (t) => {
  const scene = await remoteScene(
    t,
    { initialSession: "ssh-history" },
    {
      "remote.trustPromptResolve": ({ decision }) => ({
        state: snapshot({ workspaceTrust: decision === "trust" ? "trusted" : "read-only" }),
      }),
    },
  );
  const prompt = {
    promptId: "run-dev",
    workspace: REMOTE,
    sessionId: "ssh-history",
    status: "pending",
    kind: "process_start",
    command: "npm run dev -- --host 127.0.0.1",
    cwd: "/home/ubuntu/app",
    remoteHostLabel: "prod-vps",
    remoteSkillCount: 2,
  };
  await act(async () => scene.external.emitTrustPrompt({ ...prompt, workspace: "ssh://deploy@other/home/deploy/app" }));
  assert.equal(roles(scene.container, "alert", "process_start paused").length, 0);
  await act(async () =>
    scene.external.emitTrustPrompt({ ...prompt, promptId: "other-session", sessionId: "another-history" }),
  );
  assert.equal(roles(scene.container, "alert", "process_start paused").length, 0);
  await act(async () => scene.external.emitTrustPrompt(prompt));
  const bar = control(scene.container, "alert", "process_start paused");
  visibleText(bar, prompt.command);
  visibleText(bar, prompt.cwd);
  visibleText(bar, "Trusting will also enable 2 project skills");
  assert.equal(roles(scene.container, "status", "Safe read-only browsing").length, 0);
  await click(control(bar, "button", "Keep read-only and reject this run"));
  await scene.settled();
  assert.deepEqual(scene.external.requests("remote.trustPromptResolve"), [
    { promptId: "run-dev", decision: "keep-read-only" },
  ]);
  control(scene.container, "status", "Safe read-only browsing");
  await act(async () =>
    scene.external.emitTrustPrompt({
      ...prompt,
      promptId: "skill-deploy",
      kind: "remote_skill",
      skillName: "deploy-prod",
      command: undefined,
    }),
  );
  const skillBar = control(scene.container, "alert", "Remote skill request paused");
  visibleText(skillBar, "deploy-prod");
  await click(control(skillBar, "button", "Trust this remote repository and continue ↵"));
  await scene.settled();
  assert.deepEqual(scene.external.requests("remote.trustPromptResolve").at(-1), {
    promptId: "skill-deploy",
    decision: "trust",
  });
  assert.equal(roles(scene.container, "alert", "Remote skill request paused").length, 0);
  assert.equal(roles(scene.container, "status", "Safe read-only browsing").length, 0);
});

test("when a trust prompt cannot be resolved its inline request stays visible and the failure is reported without granting trust", async (t) => {
  const scene = await remoteScene(t, {}, { "remote.trustPromptResolve": new Error("Decision could not be saved") });
  await act(async () =>
    scene.external.emitTrustPrompt({
      promptId: "failed-run",
      workspace: REMOTE,
      status: "pending",
      kind: "process_start",
      command: "npm run dev",
      cwd: "/home/ubuntu/app",
      remoteHostLabel: "prod-vps",
      remoteSkillCount: 2,
    }),
  );
  const bar = control(scene.container, "alert", "process_start paused");
  await click(control(bar, "button", "Trust this remote repository and continue ↵"));
  await scene.settled();
  visibleText(scene.container, "Could not update the remote workspace. Decision could not be saved");
  control(scene.container, "alert", "process_start paused");
  assert.match(triggerName(scene), /read-only$/);
  assert.deepEqual(scene.external.requests("remote.trustSet"), []);
});
