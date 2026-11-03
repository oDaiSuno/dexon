import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  startNavigation,
  control,
  roles,
  click,
  input,
  keyDown,
  act,
  waitFor,
  visibleText,
  dom,
  restoreGlobals,
} from "../support/app-navigation.mjs";
import { accessibleName } from "../support/dom-queries.mjs";
import { navigationBoundary } from "../fixtures/app-navigation-host.mjs";
import { navigationPaths as P } from "../fixtures/app-navigation-data.mjs";
import { remoteHostBoundary } from "../support/api-host.mjs";

after(restoreGlobals);

const TARGET = { user: "ubuntu", host: "prod-vps", port: 22 };
const HOST = {
  alias: "prod-vps",
  ...TARGET,
  identityReady: true,
  source: "ssh-config",
  lastOpenedPath: "/home/ubuntu",
};
const SEARCH = "Search or open a project…";
const STEP_ONE = "Step 1 of 2: choose or enter a remote server";
const CONNECT = "Connect remote server (SSH)…";

function ready(target = TARGET, path = "/home/ubuntu") {
  return {
    status: "ready",
    target,
    currentPath: path,
    remoteHome: "/home/ubuntu",
    rttMs: 22,
    entries: [
      { name: "app", path: `${path}/app`, isGitRepo: true, gitBranch: "main" },
      { name: "data", path: `${path}/data`, isGitRepo: false },
    ],
  };
}

async function sceneWith(t, script = {}, options = {}) {
  const settings = { history: false, openProjects: [P.personal], ...options };
  const base = navigationBoundary(settings);
  return startNavigation(
    t,
    settings,
    remoteHostBoundary(base, {
      "remote.workspacesSnapshot": { states: {} },
      "remote.hosts": { hosts: [HOST] },
      "remote.browse": ({ target, path }) => ready(target, path),
      "system.validateCwd": ({ path }) =>
        path.startsWith("ssh://") ? { ok: true, path } : base.host.call("system.validateCwd", { path }),
      "skills.list": ({ cwd }) => (cwd.startsWith("ssh://") ? { skills: [] } : base.host.call("skills.list", { cwd })),
      ...script,
    }),
  );
}

async function serverCard(scene) {
  const card = await scene.menu();
  await click(control(card, "menuitem", CONNECT));
  await waitFor(() => control(card, "menuitem", "Browse folders on prod-vps"));
  return card;
}

test("when a configured alias points at another address browsing dials the alias so its key and jump-host settings are preserved", async (t) => {
  const candidate = { ...HOST, host: "10.0.1.8", port: 2222, proxyJump: "bastion" };
  const scene = await sceneWith(t, { "remote.hosts": { hosts: [candidate] } });
  const card = await serverCard(scene);
  visibleText(card, "ubuntu@10.0.1.8:2222");
  await click(control(card, "menuitem", "Browse folders on prod-vps"));
  await waitFor(() => control(card, "button", "Open /home/ubuntu"));
  assert.deepEqual(scene.external.requests("remote.browse"), [
    { target: { user: "ubuntu", host: "prod-vps", port: 2222 }, path: "/home/ubuntu" },
  ]);
});

test("when a Git folder is highlighted with the arrow keys Enter opens that project without needing a mouse", async (t) => {
  const scene = await sceneWith(t);
  const card = await serverCard(scene);
  await click(control(card, "menuitem", "Browse folders on prod-vps"));
  const filter = await waitFor(() => control(card, "searchbox", "Filter this directory…"));
  await keyDown(filter, "ArrowDown");
  await keyDown(filter, "Enter");
  assert.equal(await scene.currentFolder(), "ssh://ubuntu@prod-vps/home/ubuntu/app");
  assert.equal(roles(dom.window.document.body, "menu").length, 0);
});

test("when an inline fingerprint card is shown arrow keys reach its actions while Tab still closes the menu", async (t) => {
  const scene = await sceneWith(t, {
    "remote.browse": [
      {
        status: "host-key-unverified",
        target: TARGET,
        host: "prod-vps",
        keyType: "ED25519",
        fingerprint: "SHA256:keyboard",
      },
      ready(),
    ],
    "remote.acceptHostKey": { ok: true },
  });
  const card = await serverCard(scene);
  await click(control(card, "menuitem", "Browse folders on prod-vps"));
  await waitFor(() => visibleText(card, "SHA256:keyboard"));
  await keyDown(dom.window.document.activeElement, "End");
  assert.equal(accessibleName(dom.window.document.activeElement), "Confirm fingerprint and continue");
  await click(dom.window.document.activeElement);
  const filter = await waitFor(() => control(card, "searchbox", "Filter this directory…"));
  await keyDown(filter, "Tab");
  assert.equal(roles(dom.window.document.body, "menu").length, 0);
  assert.equal(accessibleName(dom.window.document.activeElement), "Switch or add project");
});

test("when a terminal command is entered pressing Enter browses its parsed server and a full address skips the browser", async (t) => {
  const scene = await sceneWith(t);
  const card = await serverCard(scene);
  const address = control(card, "textbox", "SSH server address or command");
  await input(address, "ssh -p 2222 ubuntu@47.98.12.34");
  await keyDown(address, "Enter");
  await waitFor(() => control(card, "searchbox", "Filter this directory…"));
  assert.deepEqual(
    scene.external.requests("remote.browse").map((request) => request.target),
    [{ user: "ubuntu", host: "47.98.12.34", port: 2222 }],
  );
  assert.equal(scene.external.requests("remote.browse")[0].path, undefined);
  await click(control(card, "button", "Change server"));
  await input(control(card, "textbox", "SSH server address or command"), "ubuntu@prod-vps:/home/ubuntu/app");
  await keyDown(control(card, "textbox", "SSH server address or command"), "Enter");
  assert.equal(await scene.currentFolder(), "ssh://ubuntu@prod-vps/home/ubuntu/app");
  assert.equal(scene.external.requests("remote.browse").length, 1);
});

test("when a folder request finishes after Back the project list stays visible and no remote project is opened", async (t) => {
  let finish;
  const response = new Promise((resolve) => {
    finish = resolve;
  });
  t.after(() => finish(ready()));
  const scene = await sceneWith(t, { "remote.browse": () => response });
  const card = await serverCard(scene);
  await click(control(card, "menuitem", "Browse folders on prod-vps"));
  visibleText(card, "Connecting and loading folders…");
  assert.ok(card.contains(dom.window.document.activeElement));
  await click(control(card, "button", "Back to project list"));
  control(card, "searchbox", SEARCH);
  await act(async () => finish(ready()));
  await scene.settled();
  control(card, "searchbox", SEARCH);
  assert.equal(roles(card, "menuitemradio").length, 0);
  assert.equal(await scene.currentFolder(), P.personal);
});

test("when a host fingerprint is cancelled no key is accepted and Back from the folder step returns to the list", async (t) => {
  const scene = await sceneWith(t, {
    "remote.browse": [
      {
        status: "host-key-unverified",
        target: TARGET,
        host: "prod-vps",
        keyType: "ED25519",
        fingerprint: "SHA256:cancel",
      },
      ready(),
    ],
  });
  const card = await serverCard(scene);
  await click(control(card, "menuitem", "Browse folders on prod-vps"));
  await waitFor(() => control(card, "button", "Cancel"));
  await click(control(card, "button", "Cancel"));
  visibleText(card, STEP_ONE);
  assert.deepEqual(scene.external.requests("remote.acceptHostKey"), []);
  await waitFor(() => control(card, "menuitem", "Browse folders on prod-vps"));
  await click(control(card, "menuitem", "Browse folders on prod-vps"));
  await waitFor(() => control(card, "searchbox", "Filter this directory…"));
  await click(control(card, "button", "Back to project list"));
  control(card, "searchbox", SEARCH);
});

for (const action of ["click", "ArrowRight"]) {
  test(`when a normal directory is entered with ${action} its children and selected path replace the previous directory`, async (t) => {
    const scene = await sceneWith(t);
    const card = await serverCard(scene);
    await click(control(card, "menuitem", "Browse folders on prod-vps"));
    const filter = await waitFor(() => control(card, "searchbox", "Filter this directory…"));
    await input(filter, "data");
    if (action === "click") await click(control(card, "menuitemradio", "data"));
    else {
      await keyDown(filter, "ArrowDown");
      await keyDown(filter, "ArrowRight");
    }
    await waitFor(() => control(card, "button", "Open /home/ubuntu/data"));
    assert.equal(scene.external.requests("remote.browse").at(-1).path, "/home/ubuntu/data");
    assert.equal(control(card, "searchbox", "Filter this directory…").value, "");
  });
}

test("when the welcome folder picker rejects a directory its error stays visible even with the sidebar collapsed", async (t) => {
  const scene = await sceneWith(
    t,
    {
      "system.validateCwd": ({ path }) =>
        path === P.project ? { ok: false, error: "The selected folder cannot be read" } : { ok: true, path },
    },
    { personalPrepareFailures: 1, openProjects: [] },
  );
  await waitFor(() => visibleText(scene.container, "Get Started"));
  await click(control(scene.navigation(), "button", "Hide sidebar"));
  scene.external.desktop.selectedDirectory = P.project;
  await click(control(scene.container, "button", "Choose a local folder…"));
  await waitFor(() => visibleText(scene.container, "The selected folder cannot be read"));
  assert.equal(scene.external.desktop.directoryRequests, 1);
});

test("when the folder filter has focus the Back keyboard shortcut returns to the project list", async (t) => {
  const scene = await sceneWith(t);
  const card = await serverCard(scene);
  await click(control(card, "menuitem", "Browse folders on prod-vps"));
  const filter = await waitFor(() => control(card, "searchbox", "Filter this directory…"));
  await keyDown(filter, "ArrowLeft", { altKey: true });
  await waitFor(() => control(card, "searchbox", SEARCH));
});

test("when an inline help card has focus ArrowUp reaches its last action", async (t) => {
  const scene = await sceneWith(t, {
    "remote.browse": { status: "auth-required", target: TARGET, copyIdCommand: "ssh-copy-id ubuntu@prod-vps" },
  });
  const card = await serverCard(scene);
  await click(control(card, "menuitem", "Browse folders on prod-vps"));
  await waitFor(() => control(card, "button", "Retry after setup"));
  await keyDown(dom.window.document.activeElement, "ArrowUp");
  assert.equal(accessibleName(dom.window.document.activeElement), "Retry after setup");
});

test("while configured hosts are loading the server address remains usable and the empty list appears after loading", async (t) => {
  let finish;
  const response = new Promise((resolve) => {
    finish = resolve;
  });
  t.after(() => finish({ hosts: [] }));
  const scene = await sceneWith(t, { "remote.hosts": () => response });
  const card = await scene.menu();
  await click(control(card, "menuitem", CONNECT));
  visibleText(card, "Loading configured servers…");
  await input(control(card, "textbox", "SSH server address or command"), "ubuntu@prod-vps");
  visibleText(card, "Recognized server: user ubuntu · host prod-vps · port 22");
  await act(async () => finish({ hosts: [] }));
  await waitFor(() => visibleText(card, "No configured servers yet. Paste an SSH address above."));
});

test("when the interface is Chinese the SSH search hint and server and folder steps use the Chinese copy", async (t) => {
  const scene = await sceneWith(t, {}, { language: "zh-CN" });
  const card = await scene.menu();
  assert.equal(control(card, "searchbox", "搜索或打开项目…").placeholder, "搜索项目，或粘贴 SSH 地址…");
  await click(control(card, "menuitem", "连接远程服务器 (SSH)…"));
  visibleText(card, "第 1 / 2 步：选择或输入远程服务器");
  await waitFor(() => control(card, "menuitem", "浏览 prod-vps 上的文件夹"));
  await click(control(card, "menuitem", "浏览 prod-vps 上的文件夹"));
  await waitFor(() => visibleText(card, "● prod-vps 已连上 · 22ms"));
  visibleText(card, "第 2 / 2 步：选择 prod-vps 上的项目文件夹");
  control(card, "searchbox", "输入关键词筛选当前目录…");
  control(card, "button", "打开 /home/ubuntu");
});
