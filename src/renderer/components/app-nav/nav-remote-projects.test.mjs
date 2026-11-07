import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  act,
  button,
  click,
  dom,
  input,
  keyDown,
  loadRenderer,
  mount,
  restoreGlobals,
} from "../../../../tests/support/renderer.mjs";
import { accessibleName, allByRole } from "../../../../tests/support/dom-queries.mjs";

after(restoreGlobals);
const { NavSidebar } = await loadRenderer(
  "app-nav-remote-projects",
  'export { NavSidebar } from "./src/renderer/components/app-nav/nav-sidebar.tsx";',
);

function props(overrides = {}) {
  return {
    expanded: true,
    page: "chat",
    spaceName: "Default space",
    spacePath: "/home/tester/.dexon",
    sessions: [],
    loading: false,
    error: null,
    selectedSessionId: null,
    runningSessionIds: new Set(),
    unreadSessionIds: new Set(),
    homeDir: "/home/tester",
    onToggleExpanded() {},
    onNavigate() {},
    onSelectSession() {},
    onNewSession() {},
    onRefreshSessions() {},
    onOpenSettings() {},
    onChooseFolder() {},
    onBackToPersonalSpace() {},
    ...overrides,
  };
}

test("the project switcher offers local, remote and server settings sources without opening a local picker", async (t) => {
  const chosen = [];
  const view = await mount(
    t,
    NavSidebar,
    props({
      onlineServerCount: 2,
      onChooseFolder: () => chosen.push("local"),
      onChooseRemoteFolder: () => chosen.push("remote"),
      onOpenServerSettings: () => chosen.push("settings"),
    }),
  );
  await click(button(view.container, "Switch or add project"));
  const menu = allByRole(dom.window.document.body, "menu")[0];
  assert.deepEqual(allByRole(menu, "menuitem").map(accessibleName), [
    "Add project space from folder…",
    "Add project space from remote server…",
    "Connect a remote server…",
    "Back to default space",
  ]);
  assert.match(menu.textContent, /2 online/);
  await click(allByRole(menu, "menuitem", "Add project space from remote server…")[0]);
  assert.deepEqual(chosen, ["remote"]);
  assert.equal(allByRole(dom.window.document.body, "menu").length, 0);
});

function remoteRow(overrides = {}) {
  const environment = {
    id: "gpu-a100",
    label: "lab-h100-cluster-node01",
    enabled: true,
    target: { kind: "ssh", sshAlias: "gpu-a100" },
    status: { phase: "connected", generation: 1, since: 1000 },
    descriptor: null,
  };
  return {
    key: '["gpu-a100","/work/trainer"]',
    environmentId: environment.id,
    path: "/work/trainer",
    root: "/work/trainer",
    displayPath: "/work/trainer",
    name: "trainer",
    environment,
    connection: { tone: "online", status: { kind: "connected", label: "Online" }, canSend: true },
    sessions: [],
    sessionActivity: { of: () => "idle", runAge: () => ({ kind: "not-running" }) },
    activity: {
      sessionCounts: { awaiting_input: 0, error: 0, running: 0 },
      taskCounts: { awaiting_input: 0, error: 0, running: 0 },
      unread: 0,
      workInFlight: false,
    },
    current: false,
    pinned: false,
    missing: false,
    loading: false,
    error: null,
    homeDir: "/home/ubuntu",
    ...overrides,
  };
}

test("a mounted remote space with no sessions remains visible with its host and connection tone", async (t) => {
  const view = await mount(t, NavSidebar, props({ projectRows: [remoteRow()] }));
  const project = button(view.container, "trainer");
  assert.ok(project, "an empty remote project is still a mounted project space");
  assert.equal(project.getAttribute("aria-expanded"), "false");
  const host = project.querySelector("[data-project-host]");
  assert.equal(host?.textContent, "lab-h100-cluster-node01");
  assert.equal(host?.getAttribute("data-tone"), "online");
  assert.equal(host?.getAttribute("title"), "lab-h100-cluster-node01 · Online");
  assert.ok(project.querySelector('[data-project-glyph="server"]'));
});

test("a remote project's menu exposes its server and path, disables Finder with a reason, and removes only that space", async (t) => {
  const actions = [];
  const row = remoteRow();
  const view = await mount(
    t,
    NavSidebar,
    props({
      projectRows: [row],
      onNewProjectSession: (space) => actions.push(["new", space.environmentId, space.path]),
      onCopyProjectPath: (space) => actions.push(["copy", space.environmentId, space.path]),
      onRevealProject: (space) => actions.push(["finder", space.environmentId, space.path]),
      onCloseProject: (path, environmentId) => actions.push(["remove", environmentId, path]),
      onOpenServerSettings: () => actions.push(["settings"]),
    }),
  );
  const openMenu = async () => {
    await click(button(view.container, "Actions for trainer"));
    return allByRole(dom.window.document.body, "menu")[0];
  };
  let menu = await openMenu();
  assert.match(menu.textContent, /lab-h100-cluster-node01 · Online/);
  assert.match(menu.textContent, /\/work\/trainer/);
  const finder = allByRole(menu, "menuitem", "Show in Finder")[0];
  assert.equal(finder?.getAttribute("aria-disabled"), "true");
  const reason = dom.window.document.getElementById(finder.getAttribute("aria-describedby"));
  assert.equal(reason?.textContent, "This folder is on a remote server. Copy its remote path instead.");
  await click(finder);
  assert.deepEqual(actions, []);
  await click(allByRole(menu, "menuitem", "New session in this project")[0]);
  assert.deepEqual(actions, [["new", "gpu-a100", "/work/trainer"]]);
  menu = await openMenu();
  await click(allByRole(menu, "menuitem", "Copy remote path")[0]);
  menu = await openMenu();
  await click(allByRole(menu, "menuitem", "Server connection settings…")[0]);
  menu = await openMenu();
  await click(allByRole(menu, "menuitem", "Remove project space from sidebar")[0]);
  assert.deepEqual(actions, [
    ["new", "gpu-a100", "/work/trainer"],
    ["copy", "gpu-a100", "/work/trainer"],
    ["settings"],
    ["remove", "gpu-a100", "/work/trainer"],
  ]);
});

for (const [tone, kind, status] of [
  ["online", "connected", "Online"],
  ["pending", "backoff", "Reconnecting"],
  ["offline", "offline", "Offline"],
  ["blocked", "blocked", "Needs attention"],
]) {
  test(`the remote host capsule exposes the ${tone} connection state independently of expansion`, async (t) => {
    const row = remoteRow({ connection: { tone, status: { kind, label: status }, canSend: tone === "online" } });
    const view = await mount(t, NavSidebar, props({ projectRows: [row] }));
    const toggle = button(view.container, "trainer");
    const host = toggle.querySelector("[data-project-host]");
    assert.equal(host.getAttribute("data-tone"), tone);
    assert.equal(host.getAttribute("title"), `lab-h100-cluster-node01 · ${status}`);
    await click(toggle);
    assert.equal(toggle.getAttribute("aria-expanded"), "true");
    assert.equal(host.getAttribute("data-tone"), tone);
  });
}

for (const [status, count] of [
  ["running", 5],
  ["awaiting_input", 2],
  ["unread", 3],
]) {
  test(`a folded remote project shows its ${status} activity alongside the host`, async (t) => {
    const row = remoteRow({
      activity: {
        sessionCounts: { awaiting_input: 0, error: 0, running: 0, ...(status === "unread" ? {} : { [status]: count }) },
        taskCounts: { awaiting_input: 0, error: 0, running: 0 },
        unread: status === "unread" ? count : 0,
        workInFlight: status !== "unread",
      },
    });
    const view = await mount(t, NavSidebar, props({ projectRows: [row] }));
    const toggle = button(view.container, "trainer");
    assert.ok(toggle.querySelector(`[data-activity="${status}"]`));
    assert.ok(toggle.querySelector("[data-project-host]"));
  });
}

test("searching by remote host opens the matching environment even when another server mounts the same path", async (t) => {
  const opened = [];
  const first = remoteRow();
  const second = remoteRow({
    environmentId: "staging",
    key: '["staging","/work/trainer"]',
    environment: { ...first.environment, id: "staging", label: "staging" },
  });
  const view = await mount(
    t,
    NavSidebar,
    props({ projectRows: [first, second], onOpenProject: (space) => opened.push(space) }),
  );
  await click(button(view.container, "Switch or add project"));
  const menu = allByRole(dom.window.document.body, "menu")[0];
  const search = menu.querySelector('[role="searchbox"]');
  await input(search, "staging");
  await keyDown(search, "Enter");
  assert.deepEqual(opened, [{ environmentId: "staging", path: "/work/trainer" }]);
});

test("right-clicking a remote project opens the same project actions menu", async (t) => {
  const view = await mount(t, NavSidebar, props({ projectRows: [remoteRow()] }));
  await act(async () =>
    button(view.container, "trainer").dispatchEvent(
      new dom.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    ),
  );
  const menus = allByRole(dom.window.document.body, "menu");
  assert.equal(menus.length, 1);
  assert.ok(allByRole(menus[0], "menuitem", "Copy remote path")[0]);
});
