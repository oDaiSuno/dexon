import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createDeferred } from "#test-timing";
import {
  click,
  act,
  control,
  roles,
  startNavigation,
  visibleText,
  waitFor,
  restoreGlobals,
} from "../support/app-navigation.mjs";
import { type, installBrowserEvents } from "../support/app-navigation-workspace.mjs";
import { mouseDown, input, keyDown, dom } from "../support/app-navigation.mjs";
import { navigationBoundary } from "../fixtures/app-navigation-host.mjs";
import { navigationPaths as P, startedConversation } from "../fixtures/app-navigation-data.mjs";
import { remoteHostBoundary } from "../support/api-host.mjs";
import { projectMenu } from "../support/app-navigation-projects.mjs";

after(restoreGlobals);
after(installBrowserEvents());

const REMOTE = "ssh://ubuntu@prod-vps/home/ubuntu/app";

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

function nativeEditing(t) {
  const document = dom.window.document;
  const original = Object.getOwnPropertyDescriptor(document, "execCommand");
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value(command, _ui, markup) {
      const selection = dom.window.getSelection();
      if (!selection.rangeCount || (command !== "insertHTML" && command !== "delete")) return false;
      const range = selection.getRangeAt(0);
      range.deleteContents();
      if (command === "insertHTML") {
        const fragment = range.createContextualFragment(markup);
        const last = fragment.lastChild;
        range.insertNode(fragment);
        if (last) range.setStartAfter(last);
      }
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    },
  });
  t.after(() => {
    if (original) Object.defineProperty(document, "execCommand", original);
    else delete document.execCommand;
  });
}

function skill(name, origin, patch = {}) {
  return {
    name,
    origin,
    description: name + " description",
    filePath: "/skills/" + name + "/SKILL.md",
    baseDir: "/skills/" + name,
    disableModelInvocation: false,
    sourceInfo: { scope: origin === "local-global" ? "project" : "user" },
    ...patch,
  };
}

async function openSkills(scene) {
  await click(control(scene.container, "button", "Add images or local file references"));
  await mouseDown(control(scene.container, "menuitem", /^Use a skill/));
  return waitFor(() => control(scene.container, "menu", "Use a skill"));
}

test("when the SSH skill picker opens origins keep local global skills usable and remote repository skills locked until trust refreshes the open menu", async (t) => {
  nativeEditing(t);
  let trusted = false;
  const scene = await remoteScene(
    t,
    {},
    {
      "skills.list": () => ({
        skills: [
          skill("local-scripts", "local-global", { hasLocalScripts: true }),
          skill("local-guide", "local-global"),
          skill("deploy-prod", "remote-project", { lockedByReadOnly: !trusted }),
          skill("local-project-guide", "local-project"),
        ],
      }),
      "remote.trustSet": ({ trust }) => {
        trusted = trust === "trusted";
        return { state: snapshot({ workspaceTrust: trust, trustRevision: 2 }) };
      },
    },
  );
  const picker = await openSkills(scene);
  visibleText(picker, "Global · local ~/.pi/agent/skills (2)");
  visibleText(picker, "Not limited by remote trust · read directly from this computer");
  visibleText(control(picker, "menuitem", /^local-scripts/), "Local scripts");
  visibleText(control(picker, "menuitem", /^local-guide/), "Read locally");
  visibleText(picker, "Project · remote prod-vps");
  visibleText(picker, "Found 1 · deferred in safe read-only");
  const locked = control(picker, "menuitem", /^deploy-prod/);
  visibleText(locked, "@prod-vps · locked");
  assert.equal(locked.getAttribute("aria-disabled"), "true");
  await mouseDown(locked);
  assert.equal(control(scene.container, "region", "Chat").querySelector('[role="textbox"]').textContent, "");
  const search = control(picker, "textbox");
  await input(search, "deploy-prod");
  await keyDown(search, "Enter");
  control(scene.container, "menu", "Use a skill");
  await input(search, "");
  const reads = scene.external.requests("skills.list").length;
  await click(control(picker, "button", "Trust repository to enable ↵"));
  await scene.settled();
  assert.deepEqual(scene.external.requests("remote.trustSet"), [{ workspace: REMOTE, trust: "trusted" }]);
  assert.ok(scene.external.requests("skills.list").length > reads);
  const stillOpen = control(scene.container, "menu", "Use a skill");
  const unlocked = control(stillOpen, "menuitem", /^deploy-prod/);
  assert.notEqual(unlocked.getAttribute("aria-disabled"), "true");
  assert.doesNotMatch(unlocked.textContent, /locked/);
  await mouseDown(unlocked);
  assert.equal(roles(scene.container, "menu", "Use a skill").length, 0);
  assert.match(control(control(scene.container, "region", "Chat"), "textbox").textContent, /deploy-prod/);
});

test("when the SSH composer searches and inserts an @ reference the host receives the SSH root and the composer inserts only the relative file path", async (t) => {
  nativeEditing(t);
  const scene = await remoteScene(
    t,
    {},
    {
      "files.index": {
        files: ["src/db/pool.ts"],
        matches: [{ path: "src/db/pool.ts", isDir: false }],
        truncated: false,
      },
    },
  );
  const composer = await type(scene, "@pool");
  const suggestion = await waitFor(() => control(scene.container, "button", /src\/db\/pool\.ts/));
  await mouseDown(suggestion);
  await scene.settled();
  assert.deepEqual(scene.external.requests("files.index"), [{ root: REMOTE, query: "pool" }]);
  assert.equal(control(composer, "button", "pool.ts").title, "src/db/pool.ts");
  assert.match(composer.textContent, /pool\.ts/);
  assert.doesNotMatch(composer.textContent, /ssh:\/\//);
  assert.equal(roles(scene.container, "button", /src\/db\/pool\.ts.*Mention/).length, 0);
});

test("when the active composer is local the skills picker keeps its existing labels and has no SSH group or trust action", async (t) => {
  const scene = await remoteScene(t);
  await click(control(await scene.menu("app"), "menuitem", "Back to default space"));
  await scene.settled();
  const picker = await openSkills(scene);
  control(picker, "menuitem", /^personal-checklist/);
  assert.doesNotMatch(
    picker.textContent,
    /Global · local|Project · remote|Local scripts|Read locally|deferred in safe read-only/,
  );
  assert.equal(roles(picker, "button", "Trust repository to enable ↵").length, 0);
});

test("when trust changes while an older skill refresh is pending the open picker still reloads the unlocked catalog and ignores the older locked reply", async (t) => {
  const old = createDeferred();
  const lockedSkills = [skill("deploy-prod", "remote-project", { lockedByReadOnly: true })];
  t.after(() => old.resolve({ skills: lockedSkills }));
  let trusted = false;
  let reads = 0;
  const scene = await remoteScene(
    t,
    {},
    {
      "skills.list": (params) => {
        if (params?.cwd !== REMOTE) return { skills: [] };
        reads++;
        if (reads === 2) return old.promise;
        return { skills: [skill("deploy-prod", "remote-project", { lockedByReadOnly: !trusted })] };
      },
      "remote.trustSet": () => {
        trusted = true;
        return { state: snapshot({ workspaceTrust: "trusted", trustRevision: 2 }) };
      },
    },
  );
  const picker = await openSkills(scene);
  await waitFor(() => assert.equal(reads, 2));
  await click(control(picker, "button", "Trust repository to enable ↵"));
  await waitFor(() => assert.equal(scene.external.requests("remote.trustSet").length, 1));
  await act(async () => old.resolve({ skills: lockedSkills }));
  await scene.settled();
  await waitFor(() =>
    assert.notEqual(
      control(control(scene.container, "menu", "Use a skill"), "menuitem", /^deploy-prod/).getAttribute(
        "aria-disabled",
      ),
      "true",
    ),
  );
  assert.ok(reads >= 3, "the trusted workspace gets a fresh catalog after the trust decision");
});
