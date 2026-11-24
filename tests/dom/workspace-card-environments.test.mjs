import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  act,
  click,
  createElement,
  dom,
  hover,
  keyDown,
  loadRenderer,
  mount,
  restoreGlobals,
} from "../support/renderer.mjs";
import { allByRole } from "../support/dom-queries.mjs";
import { remoteServer } from "../../src/renderer/components/remote-folder-picker/folder-browser-test-helpers.mjs";

const api = await loadRenderer(
  "workspace-card-environments",
  'export {WorkspaceCard} from "./src/renderer/components/chat-input/workspace-card.tsx";',
);
after(restoreGlobals);

const project = (environmentId, options = {}) => ({
  key: JSON.stringify([environmentId, "/work/app"]),
  environmentId,
  environmentLabel: environmentId === "primary" ? "This computer" : "Build server",
  isPrimaryEnvironment: environmentId === "primary",
  environmentState: "connected",
  unavailable: false,
  path: "/work/app",
  name: "app",
  displayPath: "/work/app",
  subline: environmentId === "primary" ? "local-main" : "remote-main",
  sublineKind: "branch",
  icon: "folder",
  current: environmentId === "primary",
  browsed: environmentId === "primary",
  missing: false,
  ...options,
});

const emptyCard = (projects, options = {}) => ({
  projects,
  pane: { state: "not-repo" },
  browsedName: "app",
  browsedEnvironmentId: "primary",
  folder: "/work/app",
  showEnvironmentGroups: projects.some((entry) => !entry.isPrimaryEnvironment),
  showFilter: true,
  filter: "",
  setFilter() {},
  blocked: null,
  dismissBlocked() {},
  openBlockedInNewWorktree() {},
  newEntryOpen: false,
  newBranch: "",
  setNewBranch() {},
  openNewEntry() {},
  closeNewEntry() {},
  createCheckout() {},
  removeCheckout() {},
  confirmRemovePath: null,
  cancelRemove() {},
  busy: false,
  error: null,
  activateProject() {},
  browseProject() {},
  activateBranch() {},
  retryBranches() {},
  ...options,
});

const control = (root, role, name) => {
  const found = allByRole(root, role, name);
  assert.equal(found.length, 1, `Expected one ${role}: ${name}`);
  return found[0];
};

async function scene(t, initialCard, actions = {}) {
  const primary = { ...remoteServer("primary"), target: { kind: "primary" } };
  let currentCard = initialCard;
  const bridge = dom.window.piBridge;
  dom.window.piBridge = {
    platform: "darwin",
    getUiState: async () => ({}),
    setUiState: async () => {},
    listEnvironments: async () => ({
      revision: 1,
      policy: { detachedDaemon: true, autoReconnect: true },
      environments: [primary, remoteServer("remote-1")],
    }),
  };
  t.after(() => {
    dom.window.piBridge = bridge;
    api.resetRpc();
  });
  api.setAppLanguage("en-US");
  function View({ card }) {
    return createElement(api.WorkspaceCard, {
      id: "workspace-environment-card",
      workspace: {
        mode: "switchable",
        environmentId: "primary",
        project: { name: "app", path: "/work/app", displayPath: "/work/app" },
        path: "/work/app",
        branch: "local-main",
        isWorktree: false,
        menuOpen: true,
        checkouts: [],
        current: null,
        currentPath: "/work/app",
        card,
        error: null,
        toggleMenu() {},
        closeMenu() {},
        openInFinder: actions.openInFinder ?? (async () => {}),
        copyPath: actions.copyPath ?? (async () => {}),
      },
      anchorRef: { current: null },
      isMobile: false,
      onRequestClose: actions.close ?? (() => {}),
      onFocusTrigger() {},
    });
  }
  const view = await mount(t, View, { card: currentCard });
  return {
    ...view,
    async updateCard(next) {
      currentCard = { ...currentCard, ...next };
      await view.update({ card: currentCard });
    },
  };
}

test("same-path projects on two machines have separately labelled groups and independent row activation", async (t) => {
  const chosen = [];
  const projects = [project("primary"), project("remote-1")];
  const view = await scene(t, emptyCard(projects, { activateProject: (key) => chosen.push(key) }));
  const local = control(view.container, "group", "This computer");
  const remote = control(view.container, "group", "Build server");
  await click(control(local, "button", "app"));
  await click(control(remote, "button", "app"));
  assert.deepEqual(chosen, ['["primary","/work/app"]', '["remote-1","/work/app"]']);
});

test("pure-local cards keep the flat project list without host labels", async (t) => {
  const view = await scene(t, emptyCard([project("primary")]));
  control(view.container, "group", "Projects");
  assert.equal(allByRole(view.container, "group", "This computer").length, 0);
  assert.equal(view.container.textContent.includes("This computer"), false);
});

test("hover and arrow-key browsing distinguish the same folder on different machines", async (t) => {
  const browsed = [];
  const projects = [project("primary"), project("remote-1")];
  const view = await scene(t, emptyCard(projects, { browseProject: (key) => browsed.push(key) }));
  const local = control(view.container, "group", "This computer");
  const remote = control(view.container, "group", "Build server");
  const localRow = control(local, "button", "app");
  const remoteRow = control(remote, "button", "app");
  await view.updateCard({ projects: [project("primary", { browsed: false }), project("remote-1", { browsed: true })] });
  await act(async () => control(view.container, "button", "Copy path").focus());
  await hover(remoteRow);
  assert.equal(control(remote, "button", "Show branches of app").style.opacity, "1");
  assert.equal(control(local, "button", "Show branches of app").style.opacity, "0");
  await view.updateCard({ projects });
  await act(async () => localRow.focus());
  await keyDown(localRow, "ArrowDown");
  assert.deepEqual(browsed, ['["remote-1","/work/app"]']);
  assert.equal(dom.window.document.activeElement, remoteRow);
});

test("unavailable projects cannot activate or expose a branch browsing button", async (t) => {
  const chosen = [];
  const view = await scene(
    t,
    emptyCard(
      [project("primary"), project("remote-1", { unavailable: true, environmentState: "offline", subline: "Offline" })],
      {
        activateProject: (key) => chosen.push(key),
      },
    ),
  );
  const remote = control(view.container, "group", "Build server");
  const row = control(remote, "button", "app");
  assert.equal(row.disabled, true);
  assert.equal(allByRole(remote, "button", "Show branches of app").length, 0);
  await act(async () => row.click());
  assert.deepEqual(chosen, []);
});

test("a disconnected server's branch pane explains offline and reconnecting states instead of showing branch controls", async (t) => {
  const view = await scene(
    t,
    emptyCard([project("remote-1")], {
      browsedEnvironmentId: "remote-1",
      pane: { state: "offline", environmentLabel: "Build server", connecting: false },
    }),
  );
  assert.ok(view.container.textContent.includes("Build server is offline"));
  assert.equal(allByRole(view.container, "button", "New worktree…").length, 0);
  await view.updateCard({ pane: { state: "offline", environmentLabel: "Build server", connecting: true } });
  assert.ok(view.container.textContent.includes("Reconnecting to Build server…"));
});

test("branch loading errors show the real message and Retry invokes recovery", async (t) => {
  let retries = 0;
  const view = await scene(
    t,
    emptyCard([project("remote-1")], {
      browsedEnvironmentId: "remote-1",
      pane: { state: "error", message: "Server permission denied" },
      error: "Server permission denied",
      retryBranches: () => {
        retries += 1;
      },
    }),
  );
  assert.ok(control(view.container, "alert").textContent.includes("Server permission denied"));
  await click(control(view.container, "button", "Retry"));
  assert.equal(retries, 1);
  await view.updateCard({
    pane: { state: "ready", count: 0, sections: { current: [], folders: [], others: [], stale: [] } },
    error: null,
  });
  assert.equal(allByRole(view.container, "alert").length, 0);
  control(view.container, "button", "New worktree…");
});

test("browsing a remote project disables local reveal and copies the browsed remote path instead of the active local path", async (t) => {
  const copied = [];
  let localReveal = 0;
  let localCopies = 0;
  const original = Object.getOwnPropertyDescriptor(dom.window.navigator, "clipboard");
  Object.defineProperty(dom.window.navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (value) => copied.push(value) },
  });
  t.after(() => {
    if (original) Object.defineProperty(dom.window.navigator, "clipboard", original);
    else delete dom.window.navigator.clipboard;
  });
  const view = await scene(
    t,
    emptyCard([project("primary", { browsed: false }), project("remote-1", { browsed: true })], {
      browsedEnvironmentId: "remote-1",
      folder: "/srv/remote/app",
    }),
    {
      openInFinder: async () => {
        localReveal += 1;
      },
      copyPath: async () => {
        localCopies += 1;
      },
    },
  );
  const reveal = control(view.container, "button", "Show in Finder");
  assert.equal(reveal.getAttribute("aria-disabled"), "true");
  await click(reveal);
  assert.equal(localReveal, 0);
  await click(control(view.container, "button", "Copy remote path"));
  assert.deepEqual(copied, ["/srv/remote/app"]);
  assert.equal(localCopies, 0);
});

test("opening a card whose browsed server is offline still puts keyboard focus on an available project", async (t) => {
  const view = await scene(
    t,
    emptyCard(
      [
        project("primary", { browsed: false }),
        project("remote-1", { browsed: true, unavailable: true, environmentState: "offline", subline: "Offline" }),
      ],
      {
        browsedEnvironmentId: "remote-1",
        pane: { state: "offline", environmentLabel: "Build server", connecting: false },
      },
    ),
  );
  const local = control(control(view.container, "group", "This computer"), "button", "app");
  assert.equal(dom.window.document.activeElement === local, true);
});
