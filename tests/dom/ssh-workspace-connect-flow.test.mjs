import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  startNavigation,
  control,
  roles,
  click,
  input,
  keyDown,
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

const CONNECT = "Connect remote server (SSH)…";
const STEP_ONE = "Step 1 of 2: choose or enter a remote server";
const SEARCH = "Search or open a project…";
const TARGET = { user: "ubuntu", host: "prod-vps", port: 22 };
const ROOT = "/home/ubuntu/work";
const REMOTE = "ssh://ubuntu@prod-vps/home/ubuntu/work/app";

async function connectScene(t, script = {}, options = {}) {
  const settings = { history: false, openProjects: [P.personal], ...options };
  const base = navigationBoundary(settings);
  const external = remoteHostBoundary(base, {
    "remote.workspacesSnapshot": { states: {} },
    "remote.hosts": { hosts: [] },
    "system.validateCwd": (params) =>
      params.path.startsWith("ssh://") ? { ok: true, path: params.path } : base.host.call("system.validateCwd", params),
    "skills.list": (params) =>
      params?.cwd?.startsWith("ssh://") ? { skills: [] } : base.host.call("skills.list", params),
    ...script,
  });
  const scene = await startNavigation(t, settings, external);
  await scene.settled();
  return scene;
}

async function servers(scene) {
  const card = await scene.menu();
  await click(control(card, "menuitem", CONNECT));
  visibleText(card, STEP_ONE);
  return card;
}

test("the SSH entry follows the local folder action and opens step one in the same project menu", async (t) => {
  const scene = await connectScene(t);
  const card = await scene.menu();
  const names = roles(card, "menuitem").map(accessibleName);
  assert.equal(names[names.indexOf("Add project space from folder…") + 1], CONNECT);
  await click(control(card, "menuitem", CONNECT));
  assert.equal(control(dom.window.document.body, "menu"), card);
  visibleText(card, STEP_ONE);
  control(card, "button", "Back to project list");
  await click(control(card, "button", "Back to project list"));
  control(card, "searchbox", SEARCH);
  await keyDown(control(card, "searchbox", SEARCH), "Escape");
  assert.equal(roles(dom.window.document.body, "menu").length, 0);
});

test("when the default space cannot be prepared the welcome page offers both folders and SSH even with a collapsed sidebar", async (t) => {
  const scene = await connectScene(t, {}, { personalPrepareFailures: 1, openProjects: [] });
  await waitFor(() => visibleText(scene.container, "Get Started"));
  visibleText(
    scene.container,
    "You can open a folder on this computer, or connect straight to a project folder on a remote Linux server (model keys and chat history always stay on this computer).",
  );
  control(scene.container, "button", "Choose a local folder…");
  await click(control(scene.navigation(), "button", "Hide sidebar"));
  await click(control(scene.container, "button", CONNECT));
  await waitFor(() => visibleText(control(dom.window.document.body, "menu"), STEP_ONE));
  control(scene.navigation(), "button", "Hide sidebar");
});

test("pasting a terminal SSH command recognizes its user host and port before connecting", async (t) => {
  const scene = await connectScene(t);
  const card = await servers(scene);
  const address = control(card, "textbox", "SSH server address or command");
  await input(address, "ssh -p 2222 ubuntu@47.98.12.34");
  visibleText(card, "Recognized the terminal command: user ubuntu · host 47.98.12.34 · port 2222");
  assert.equal(control(card, "button", "Connect and choose folder").disabled, false);
});

for (const address of ["ubuntu@prod-vps:/home/ubuntu/work/app", REMOTE]) {
  test(`pasting ${address} offers a leading remote folder action and Enter opens it through folder validation`, async (t) => {
    const scene = await connectScene(t);
    const card = await scene.menu();
    const search = control(card, "searchbox", SEARCH);
    await input(search, address);
    assert.equal(
      accessibleName(roles(card, "menuitem")[0]),
      "Open remote folder ubuntu@prod-vps:/home/ubuntu/work/app",
    );
    await keyDown(search, "Enter");
    await waitFor(async () => assert.equal(await scene.currentFolder(), REMOTE));
    visibleText(scene.history(), "@prod-vps · offline");
    assert.equal(roles(dom.window.document.body, "menu").length, 0);
    assert.ok(scene.external.requests("system.validateCwd").some((params) => params.path === REMOTE));
    assert.deepEqual(scene.external.requests("projects.inspectFolder"), []);
  });
}

test("configured servers show aliases real dial addresses jump hosts keys and the last folder", async (t) => {
  const scene = await connectScene(t, {
    "remote.hosts": {
      hosts: [
        {
          alias: "production",
          host: "10.0.1.8",
          user: "ubuntu",
          port: 2222,
          proxyJump: "bastion",
          identityReady: true,
          source: "ssh-config",
          lastOpenedPath: "/home/ubuntu/app",
        },
      ],
    },
  });
  const card = await servers(scene);
  await waitFor(() => visibleText(card, "production"));
  visibleText(card, "ubuntu@10.0.1.8:2222");
  visibleText(card, "ProxyJump");
  visibleText(card, "Key ready");
  visibleText(card, "Last opened /home/ubuntu/app");
  control(card, "menuitem", "Browse folders on production");
});

test("a server list failure stays inline and Retry loads the empty configured server list", async (t) => {
  let attempts = 0;
  const scene = await connectScene(t, {
    "remote.hosts": () => {
      if (++attempts === 1) throw new Error("SSH config could not be read");
      return { hosts: [] };
    },
  });
  const card = await servers(scene);
  await waitFor(() => visibleText(card, "SSH config could not be read"));
  await click(control(card, "button", "Retry"));
  await waitFor(() => visibleText(card, "No configured servers yet. Paste an SSH address above."));
});

test("the welcome local folder button uses the same native picker and validation as the sidebar", async (t) => {
  const scene = await connectScene(t, {}, { personalPrepareFailures: 1, openProjects: [] });
  await waitFor(() => visibleText(scene.container, "Get Started"));
  scene.external.desktop.selectedDirectory = P.project;
  await click(control(scene.container, "button", "Choose a local folder…"));
  await waitFor(async () => assert.equal(await scene.currentFolder(), P.project));
  assert.equal(scene.external.desktop.directoryRequests, 1);
});

const HOST = {
  alias: "production",
  host: "prod-vps",
  user: "ubuntu",
  port: 22,
  identityReady: true,
  source: "recent",
  lastOpenedPath: ROOT,
};

function ready(
  path = ROOT,
  entries = [
    { name: "datasets", path: `${ROOT}/datasets`, isGitRepo: false },
    { name: "app", path: `${ROOT}/app`, isGitRepo: true, gitBranch: "main" },
    { name: "billing", path: `${ROOT}/billing`, isGitRepo: true, gitBranch: "feat/invoices" },
  ],
) {
  return { status: "ready", target: TARGET, currentPath: path, remoteHome: "/home/ubuntu", rttMs: 22, entries };
}

async function folders(scene) {
  const card = await servers(scene);
  await waitFor(() => control(card, "menuitem", "Browse folders on production"));
  await click(control(card, "menuitem", "Browse folders on production"));
  return card;
}

test("choosing a recent server browses its real host with repos first breadcrumbs filtering and a selected folder CTA", async (t) => {
  const scene = await connectScene(t, {
    "remote.hosts": { hosts: [HOST] },
    "remote.browse": ({ path }) => ready(path ?? ROOT),
  });
  const card = await folders(scene);
  await waitFor(() => visibleText(card, "● prod-vps connected · 22ms"));
  visibleText(card, "Step 2 of 2: choose a project folder on prod-vps");
  assert.deepEqual(scene.external.requests("remote.browse"), [{ target: TARGET, path: ROOT }]);
  assert.deepEqual(roles(card, "menuitemradio").map(accessibleName), ["app", "billing", "datasets"]);
  visibleText(control(card, "menuitemradio", "app"), "Git repo");
  visibleText(control(card, "menuitemradio", "app"), "main");
  control(card, "button", `Open ${ROOT}`);
  await click(control(card, "button", "home"));
  await waitFor(() => control(card, "button", "Open /home"));
  assert.equal(scene.external.requests("remote.browse").at(-1).path, "/home");
  const filter = control(card, "searchbox", "Filter this directory…");
  await input(filter, "billing");
  assert.deepEqual(roles(card, "menuitemradio").map(accessibleName), ["billing"]);
  await input(filter, "app");
  await click(control(card, "menuitemradio", "app"));
  assert.equal(control(card, "menuitemradio", "app").getAttribute("aria-checked"), "true");
  visibleText(card, "First open defaults to safe read-only browsing; local keys are never uploaded");
  await click(control(card, "button", `Open ${ROOT}/app`));
  await waitFor(async () => assert.equal(await scene.currentFolder(), REMOTE));
  assert.ok(scene.external.requests("system.validateCwd").some((params) => params.path === REMOTE));
});

test("an unverified host shows its fingerprint and confirming it accepts that exact fingerprint before browsing again", async (t) => {
  const fingerprint = "SHA256:review-this-server";
  const scene = await connectScene(t, {
    "remote.hosts": { hosts: [HOST] },
    "remote.browse": [
      { status: "host-key-unverified", target: TARGET, host: "prod-vps", keyType: "ED25519", fingerprint },
      ready(),
    ],
    "remote.acceptHostKey": { ok: true },
  });
  const card = await folders(scene);
  await waitFor(() => visibleText(card, "First connection to prod-vps: please confirm it is your server"));
  visibleText(card, fingerprint);
  visibleText(card, "ED25519");
  control(card, "button", "Cancel");
  assert.equal(roles(card, "menuitemradio").length, 0);
  await click(control(card, "button", "Confirm fingerprint and continue"));
  await waitFor(() => control(card, "menuitemradio", "app"));
  assert.deepEqual(scene.external.requests("remote.acceptHostKey"), [{ target: TARGET, fingerprint }]);
  assert.equal(scene.external.requests("remote.browse").length, 2);
});

function useClipboard(t, writeText) {
  const original = Object.getOwnPropertyDescriptor(dom.window.navigator, "clipboard");
  Object.defineProperty(dom.window.navigator, "clipboard", { configurable: true, value: { writeText } });
  t.after(() => {
    if (original) Object.defineProperty(dom.window.navigator, "clipboard", original);
    else delete dom.window.navigator.clipboard;
  });
}

test("when SSH authentication needs setup the exact command can be copied and retry returns to folders", async (t) => {
  const command = "ssh-copy-id -p 2222 ubuntu@prod-vps";
  let clipboard = "";
  useClipboard(t, async (value) => {
    clipboard = value;
  });
  const scene = await connectScene(t, {
    "remote.hosts": { hosts: [HOST] },
    "remote.browse": [{ status: "auth-required", target: TARGET, copyIdCommand: command }, ready()],
  });
  const card = await folders(scene);
  await waitFor(() => visibleText(card, command));
  assert.equal(roles(card, "menuitemradio").length, 0);
  await click(control(card, "button", "Copy command"));
  await waitFor(() => control(card, "button", "Copied"));
  assert.equal(clipboard, command);
  await click(control(card, "button", "Retry after setup"));
  await waitFor(() => control(card, "menuitemradio", "app"));
  assert.equal(scene.external.requests("remote.browse").length, 2);
});

for (const canAutoInstall of [true, false]) {
  test(`when Python is missing with automatic install ${canAutoInstall ? "allowed" : "unavailable"} the command remains copyable and recovery is explicit`, async (t) => {
    const command = "sudo apt-get update && sudo apt-get install -y python3";
    let clipboard = "";
    useClipboard(t, async (value) => {
      clipboard = value;
    });
    const scene = await connectScene(t, {
      "remote.hosts": { hosts: [HOST] },
      "remote.browse": [{ status: "python-missing", target: TARGET, installCommand: command, canAutoInstall }, ready()],
      "remote.installPython": { ok: true },
    });
    const card = await folders(scene);
    await waitFor(() => visibleText(card, command));
    const install = control(card, "button", "Install on the server and continue");
    assert.equal(install.disabled, !canAutoInstall);
    await click(control(card, "button", "Copy command"));
    await waitFor(() => control(card, "button", "Copied"));
    assert.equal(clipboard, command);
    await click(canAutoInstall ? install : control(card, "button", "Retry after setup"));
    await waitFor(() => control(card, "menuitemradio", "app"));
    assert.deepEqual(scene.external.requests("remote.installPython"), canAutoInstall ? [{ target: TARGET }] : []);
    assert.equal(scene.external.requests("remote.browse").length, 2);
  });
}

for (const failure of [
  { status: "error", target: TARGET, message: "Remote folder is unavailable" },
  new Error("SSH connection was interrupted"),
]) {
  test(`when browsing fails with ${failure.message} an inline Retry restores folders without losing the server`, async (t) => {
    const scene = await connectScene(t, {
      "remote.hosts": { hosts: [HOST] },
      "remote.browse": [failure, ready()],
    });
    const card = await folders(scene);
    await waitFor(() => visibleText(card, failure.message));
    await click(control(card, "button", "Retry"));
    await waitFor(() => control(card, "menuitemradio", "app"));
    assert.deepEqual(scene.external.requests("remote.browse"), [
      { target: TARGET, path: ROOT },
      { target: TARGET, path: ROOT },
    ]);
  });
}

test("when the clipboard rejects a setup command the card reports it and copying can be retried", async (t) => {
  let allowed = false;
  let clipboard = "";
  useClipboard(t, async (value) => {
    if (!allowed) throw new Error("Clipboard permission denied");
    clipboard = value;
  });
  const command = "ssh-copy-id ubuntu@prod-vps";
  const scene = await connectScene(t, {
    "remote.hosts": { hosts: [HOST] },
    "remote.browse": { status: "auth-required", target: TARGET, copyIdCommand: command },
  });
  const card = await folders(scene);
  await waitFor(() => visibleText(card, command));
  await click(control(card, "button", "Copy command"));
  await waitFor(() => control(card, "alert", "Could not copy. Check clipboard permission and try again."));
  assert.equal(clipboard, "");
  allowed = true;
  await click(control(card, "button", "Copy command"));
  await waitFor(() => control(card, "button", "Copied"));
  assert.equal(clipboard, command);
  assert.equal(roles(card, "alert").length, 0);
});

test("the project search visibly advertises SSH while keeping its established accessible name", async (t) => {
  const scene = await connectScene(t);
  const card = await scene.menu();
  const search = control(card, "searchbox", SEARCH);
  assert.equal(search.placeholder, "Search projects, or paste an SSH address…");
  assert.equal(search.getAttribute("aria-description"), "Search projects, or paste an SSH address…");
});

test("when a fingerprint needs confirmation keyboard focus stays in the card and Escape closes it", async (t) => {
  const scene = await connectScene(t, {
    "remote.hosts": { hosts: [HOST] },
    "remote.browse": {
      status: "host-key-unverified",
      target: TARGET,
      host: "prod-vps",
      keyType: "ED25519",
      fingerprint: "SHA256:confirm",
    },
  });
  const card = await folders(scene);
  await waitFor(() => visibleText(card, "SHA256:confirm"));
  assert.ok(
    card.contains(dom.window.document.activeElement),
    "The connection card must keep keyboard focus while waiting for confirmation",
  );
  await keyDown(dom.window.document.activeElement, "Escape");
  assert.equal(roles(dom.window.document.body, "menu").length, 0);
  assert.equal(accessibleName(dom.window.document.activeElement), "Switch or add project");
});

test("when no child folder is highlighted Enter opens the current remote directory", async (t) => {
  const scene = await connectScene(t, { "remote.hosts": { hosts: [HOST] }, "remote.browse": ready() });
  const card = await folders(scene);
  await waitFor(() => control(card, "searchbox", "Filter this directory…"));
  await keyDown(control(card, "searchbox", "Filter this directory…"), "Enter");
  assert.equal(await scene.currentFolder(), "ssh://ubuntu@prod-vps/home/ubuntu/work");
  assert.equal(roles(dom.window.document.body, "menu").length, 0);
});

for (const operation of [
  {
    method: "remote.acceptHostKey",
    label: "Confirm fingerprint and continue",
    result: {
      status: "host-key-unverified",
      target: TARGET,
      host: "prod-vps",
      keyType: "ED25519",
      fingerprint: "SHA256:failure",
    },
  },
  {
    method: "remote.installPython",
    label: "Install on the server and continue",
    result: {
      status: "python-missing",
      target: TARGET,
      installCommand: "apt-get install python3",
      canAutoInstall: true,
    },
  },
]) {
  test(`when ${operation.method} is rejected its inline error allows a fresh browse without an unhandled rejection`, async (t) => {
    const scene = await connectScene(t, {
      "remote.hosts": { hosts: [HOST] },
      "remote.browse": [operation.result, ready()],
      [operation.method]: new Error("The server declined the requested setup"),
    });
    const card = await folders(scene);
    await waitFor(() => control(card, "button", operation.label));
    await click(control(card, "button", operation.label));
    await waitFor(() => visibleText(card, "The server declined the requested setup"));
    assert.equal(roles(card, "menuitemradio").length, 0);
    await click(control(card, "button", "Retry"));
    await waitFor(() => control(card, "menuitemradio", "app"));
    assert.equal(scene.external.requests(operation.method).length, 1);
  });
}
