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
import { createElement, useState } from "react";

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

for (const controlled of [false, true]) {
  test(`${controlled ? "controlled" : "local"} branch expansion stays separate when local and remote sessions share IDs`, async (t) => {
    const sessions = (environmentId, cwd) => [
      {
        id: "same-root",
        name: "Shared root",
        path: "/sessions/root.json",
        cwd,
        created: "2026-01-01T00:00:00.000Z",
        modified: "2026-01-01T00:00:00.000Z",
        firstMessage: "root",
        messageCount: 2,
        environmentId,
      },
      {
        id: "same-child",
        name: "Shared child",
        path: "/sessions/child.json",
        cwd,
        parentSessionId: "same-root",
        created: "2026-01-01T00:00:00.000Z",
        modified: "2026-01-01T00:00:00.000Z",
        firstMessage: "child",
        messageCount: 2,
        environmentId,
      },
    ];
    const local = remoteRow({
      key: '["primary","/work/trainer"]',
      environmentId: "primary",
      name: "local trainer",
      sessions: sessions("primary", "/work/trainer"),
    });
    const remote = remoteRow({ sessions: sessions("gpu-a100", "/work/trainer") });
    function NavigationOwner() {
      const [expandedSessionIds, setExpandedSessionIds] = useState(() => new Set());
      return createElement(
        NavSidebar,
        props({
          projectRows: [local, remote],
          expandedProjects: new Map([
            [local.key, true],
            [remote.key, true],
          ]),
          ...(controlled
            ? {
                expandedSessionIds,
                onToggleExpand: (id) =>
                  setExpandedSessionIds((current) => {
                    const next = new Set(current);
                    if (!next.delete(id)) next.add(id);
                    return next;
                  }),
              }
            : {}),
        }),
      );
    }
    const view = await mount(t, NavigationOwner);
    const environment = (id) => view.container.querySelector(`[data-environment-id="${id}"]`);
    assert.equal(allByRole(environment("primary"), "button", /^Shared child/).length, 0);
    assert.equal(allByRole(environment("gpu-a100"), "button", /^Shared child/).length, 0);
    await click(button(environment("primary"), "Expand forks"));
    assert.equal(allByRole(environment("primary"), "button", /^Shared child/).length, 1);
    assert.equal(allByRole(environment("gpu-a100"), "button", /^Shared child/).length, 0);
    await click(button(environment("gpu-a100"), "Expand forks"));
    assert.equal(allByRole(environment("gpu-a100"), "button", /^Shared child/).length, 1);
    await click(button(environment("primary"), "Collapse forks"));
    assert.equal(allByRole(environment("primary"), "button", /^Shared child/).length, 0);
    assert.equal(allByRole(environment("gpu-a100"), "button", /^Shared child/).length, 1);
  });
}

test("selected old roots and Load more stay scoped to their project when environments share session IDs", async (t) => {
  const sessions = Array.from({ length: 7 }, (_, index) => ({
    id: `shared-${index + 1}`,
    name: `Shared task ${index + 1}`,
    path: `/sessions/shared-${index + 1}.json`,
    cwd: "/work/trainer",
    created: "2026-01-01T00:00:00.000Z",
    modified: `2026-01-${String(31 - index).padStart(2, "0")}T00:00:00.000Z`,
    firstMessage: "shared task",
    messageCount: 2,
  }));
  const local = remoteRow({
    key: '["primary","/work/trainer"]',
    environmentId: "primary",
    name: "local trainer",
    sessions,
  });
  const remote = remoteRow({ sessions });
  const view = await mount(
    t,
    NavSidebar,
    props({
      projectRows: [local, remote],
      expandedProjects: new Map([
        [local.key, true],
        [remote.key, true],
      ]),
      selectedSessionId: "shared-7",
      selectedEnvironmentId: "gpu-a100",
    }),
  );
  const environment = (id) => view.container.querySelector(`[data-environment-id="${id}"]`);
  const ids = (id) => [...environment(id).querySelectorAll("[data-session-id]")].map((row) => row.dataset.sessionId);
  assert.deepEqual(ids("primary"), ["shared-1", "shared-2", "shared-3", "shared-4", "shared-5"]);
  assert.deepEqual(ids("gpu-a100"), ["shared-1", "shared-2", "shared-3", "shared-4", "shared-5", "shared-7"]);
  assert.equal(button(environment("gpu-a100"), "Shared task 7").getAttribute("aria-current"), "page");
  assert.equal(button(environment("primary"), "Load more sessions").querySelector(".type-mono-meta").textContent, "2");
  assert.equal(button(environment("gpu-a100"), "Load more sessions").querySelector(".type-mono-meta").textContent, "1");
  await click(button(environment("primary"), "Load more sessions"));
  assert.deepEqual(ids("primary"), [
    "shared-1",
    "shared-2",
    "shared-3",
    "shared-4",
    "shared-5",
    "shared-6",
    "shared-7",
  ]);
  assert.deepEqual(ids("gpu-a100"), ["shared-1", "shared-2", "shared-3", "shared-4", "shared-5", "shared-7"]);
  assert.equal(button(environment("primary"), "Shared task 7").getAttribute("aria-current"), null);
  assert.ok(button(environment("gpu-a100"), "Load more sessions"));
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
