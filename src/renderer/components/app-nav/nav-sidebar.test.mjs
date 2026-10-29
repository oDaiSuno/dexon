import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  act,
  button,
  byRole,
  click,
  createElement,
  dom,
  input,
  keyDown,
  loadRenderer,
  mount,
  restoreGlobals,
  waitFor,
} from "../../../../tests/support/renderer.mjs";
import { accessibleName, allByRole, precedes, text } from "../../../../tests/support/dom-queries.mjs";
import { useState } from "react";
import { navigationSessions } from "../../../../tests/fixtures/nav-sidebar.mjs";

after(restoreGlobals);
const { NavSidebar } = await loadRenderer(
  "app-nav-sidebar",
  'export { NavSidebar } from "./src/renderer/components/app-nav/nav-sidebar.tsx";',
);

function baseProps(overrides = {}) {
  const calls = { toggle: 0, navigate: [], select: 0, newSession: 0, refresh: 0, settings: 0 };
  return {
    props: {
      expanded: true,
      page: "chat",
      spaceName: "Default space",
      spacePath: "/Users/tester/.dexon",
      sessions: navigationSessions,
      loading: false,
      error: null,
      selectedSessionId: null,
      runningSessionIds: new Set(),
      unreadSessionIds: new Set(),
      homeDir: "/Users/tester",
      onToggleExpanded: () => calls.toggle++,
      onNavigate: (page) => calls.navigate.push(page),
      onSelectSession: () => calls.select++,
      onNewSession: () => calls.newSession++,
      onRefreshSessions: () => calls.refresh++,
      onOpenSettings: () => calls.settings++,
      onChooseFolder: () => {},
      onBackToPersonalSpace: () => {},
      ...overrides,
    },
    calls,
  };
}

function cardIs() {
  const cards = allByRole(dom.window.document.body, "menu");
  assert.equal(cards.length, 1, `Expected one open project switcher card; found ${cards.length}`);
  return cards[0];
}

async function cardFromHeader(view) {
  const plus = button(view.container, "Switch or add project");
  assert.ok(plus, "the project spaces header offers a button named Switch or add project");
  await click(plus);
  return waitFor(() => cardIs());
}

function cardAction(card, label) {
  const actions = allByRole(card, "menuitem", label);
  assert.equal(actions.length, 1, `Expected one card action named ${label}; found ${actions.length}`);
  return actions[0];
}

function cardSearch(card) {
  return byRole(card, "searchbox", "Search or open a project…");
}

function cardHighlight(card) {
  const id = cardSearch(card).getAttribute("aria-activedescendant");
  if (!id) return null;
  const element = dom.window.document.getElementById(id);
  assert.ok(element, "the highlighted id points at a row in the card");
  return accessibleName(element);
}

function cardText(card, value) {
  const element = text(card, value);
  assert.ok(element, `Expected the card to show ${value}`);
  return element;
}

const CARD_ACTIONS = ["Add project space from folder…", "Back to default space"];

test("expanded navigation presents space, main entries, history and settings", async (t) => {
  const { props } = baseProps({ isDefaultProject: (root) => root === "/Users/tester/.dexon" });
  const view = await mount(t, NavSidebar, props);
  assert.ok(button(view.container, "Hide sidebar"));
  assert.ok(byRole(view.container, "searchbox", "Search sessions"), "the session search is always visible");
  assert.ok(button(view.container, "Switch or add project"), "the header opens the project switcher card");
  assert.ok(button(view.container, "Collapse all projects"), "the header folds the open project rows");
  assert.equal(
    allByRole(view.container, "button", "Actions for Default space").length,
    0,
    "the default space row cannot be moved or closed, so it has no actions button",
  );
  assert.match(view.container.textContent, /Default space/);
  const newSession = button(view.container, "New session");
  assert.ok(newSession, "the navigation offers an entry named New session");
  assert.equal(newSession.getAttribute("aria-current"), null);
  assert.equal(button(view.container, "Plugins & Skills").getAttribute("aria-current"), null);
  for (const label of ["Switch or add project", "Settings"]) assert.ok(button(view.container, label));
  assert.match(view.container.textContent, /Project spaces/);
  assert.match(view.container.textContent, /alpha render bug/);
});

test("the top bar shows the decorative product icon on the button that hides the sidebar", async (t) => {
  const { props, calls } = baseProps();
  const view = await mount(t, NavSidebar, props);
  const toggle = button(view.container, "Hide sidebar");
  const icon = toggle.querySelector("img");
  assert.ok(icon, "the product icon is shown in the top bar");
  assert.equal(icon.getAttribute("aria-hidden"), "true", "the product icon stays decorative");
  await click(toggle);
  assert.equal(calls.toggle, 1);
});

test("the first main entry starts a new session and the second one shows Plugins & Skills", async (t) => {
  const { props, calls } = baseProps();
  const view = await mount(t, NavSidebar, props);
  const newSession = button(view.container, "New session");
  const plugins = button(view.container, "Plugins & Skills");
  assert.ok(newSession, "the navigation offers an entry named New session");
  assert.ok(precedes(newSession, plugins), "New session is listed before Plugins & Skills");
  assert.equal(newSession.getAttribute("aria-current"), null);
  await click(newSession);
  await click(plugins);
  assert.equal(calls.newSession, 1);
  assert.deepEqual(calls.navigate, ["resources"]);
});

test("the project list header adds a folder as a project space without a new-session entry", async (t) => {
  let chosen = 0;
  const { props, calls } = baseProps({ onChooseFolder: () => chosen++ });
  const view = await mount(t, NavSidebar, props);
  const projects = byRole(view.container, "navigation", "Project spaces");
  assert.equal(
    allByRole(projects, "button", /^new session$/i).length,
    0,
    "the list has no new-session entry of its own",
  );
  const card = await cardFromHeader(view);
  await click(cardAction(card, "Add project space from folder…"));
  assert.equal(chosen, 1);
  assert.equal(calls.newSession, 0);
});

test("the + opens one card with the current project and its two space actions, and no Close project", async (t) => {
  const { props } = baseProps();
  const view = await mount(t, NavSidebar, props);
  assert.equal(allByRole(dom.window.document.body, "menu").length, 0, "no card is open before the + is used");
  const card = await cardFromHeader(view);
  assert.deepEqual(
    allByRole(card, "menuitem").map(accessibleName),
    CARD_ACTIONS,
    "the card offers the two approved space actions, in order",
  );
  const search = cardSearch(card);
  const group = cardText(card, "Current project");
  const name = cardText(card, "Default space");
  const folder = cardText(card, "~");
  assert.ok(precedes(search, group), "the search box comes first");
  assert.ok(precedes(group, name), "the current project is named under its own heading");
  assert.ok(precedes(name, folder), "the folder the project lives in follows its name");
  assert.ok(precedes(folder, cardAction(card, "Add project space from folder…")), "the actions come last");
  assert.equal(allByRole(card, "menuitem", "Close project").length, 0, "closing a project is not offered here");
});

test("choosing a space action runs only that action and closes the card", async (t) => {
  let added = 0;
  let back = 0;
  const { props } = baseProps({
    onChooseFolder: () => added++,
    onBackToPersonalSpace: () => back++,
  });
  const view = await mount(t, NavSidebar, props);
  const card = await cardFromHeader(view);
  await click(cardAction(card, "Add project space from folder…"));
  assert.deepEqual({ added, back }, { added: 1, back: 0 }, "only the chosen action runs");
  assert.equal(allByRole(dom.window.document.body, "menu").length, 0, "the card closes after the action");
  const reopened = await cardFromHeader(view);
  await click(cardAction(reopened, "Back to default space"));
  assert.deepEqual({ added, back }, { added: 1, back: 1 }, "the second action runs once too");
});

test("Escape closes the card and gives the keyboard back to the +", async (t) => {
  const { props } = baseProps();
  const view = await mount(t, NavSidebar, props);
  const plus = button(view.container, "Switch or add project");
  const card = await cardFromHeader(view);
  assert.equal(plus.getAttribute("aria-expanded"), "true", "the + says the card is open");
  await keyDown(card, "Escape");
  assert.equal(allByRole(dom.window.document.body, "menu").length, 0, "Escape closes the card");
  assert.ok(dom.window.document.activeElement === plus, "the keyboard returns to the + that opened it");
});

test("a press outside the card closes it, while a press inside leaves it open", async (t) => {
  const { props } = baseProps();
  const view = await mount(t, NavSidebar, props);
  const card = await cardFromHeader(view);
  await act(async () => {
    cardText(card, "Current project").dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true }));
  });
  assert.equal(allByRole(dom.window.document.body, "menu").length, 1, "a press inside the card leaves it open");
  await act(async () => {
    dom.window.document.body.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true }));
  });
  assert.equal(allByRole(dom.window.document.body, "menu").length, 0, "a press outside closes the card");
});

test("the arrow keys walk the card's actions and Enter runs the one in view", async (t) => {
  let added = 0;
  let back = 0;
  const { props } = baseProps({ onChooseFolder: () => added++, onBackToPersonalSpace: () => back++ });
  const view = await mount(t, NavSidebar, props);
  const plus = button(view.container, "Switch or add project");
  const card = await cardFromHeader(view);
  const search = cardSearch(card);
  assert.equal(dom.window.document.activeElement, search, "opening the card puts the keyboard in its search box");
  assert.equal(cardHighlight(card), null, "nothing is highlighted before the first arrow press");
  await keyDown(search, "ArrowDown");
  assert.equal(cardHighlight(card), CARD_ACTIONS[0], "ArrowDown reaches the first action");
  await keyDown(search, "ArrowDown");
  assert.equal(cardHighlight(card), CARD_ACTIONS[1], "ArrowDown moves to the next action");
  await keyDown(search, "ArrowDown");
  assert.equal(cardHighlight(card), CARD_ACTIONS[0], "ArrowDown wraps to the first action");
  await keyDown(search, "ArrowUp");
  assert.equal(cardHighlight(card), CARD_ACTIONS[1], "ArrowUp wraps to the last action");
  assert.equal(dom.window.document.activeElement, search, "walking the actions keeps the keyboard in the search box");
  await keyDown(search, "Enter");
  assert.deepEqual({ added, back }, { added: 0, back: 1 }, "Enter runs only the action in view");
  assert.equal(allByRole(dom.window.document.body, "menu").length, 0, "the card closes after the action");
  assert.equal(dom.window.document.activeElement, plus, "the keyboard goes back to the + that opened the card");
});

test("the card's search box is named for its purpose and shows the shortcut and the key hints", async (t) => {
  const previousBridge = dom.window.piBridge;
  dom.window.piBridge = { ...previousBridge, platform: "darwin" };
  try {
    const { props } = baseProps();
    const view = await mount(t, NavSidebar, props);
    const card = await cardFromHeader(view);
    assert.equal(cardSearch(card).getAttribute("placeholder"), "Search or open a project…");
    const lines = [...card.querySelectorAll("span,kbd")].map((element) => (element.textContent ?? "").trim());
    assert.ok(lines.includes("⌘P"), "the search row shows the shortcut that opens this card");
    for (const hint of ["↑↓", "Select", "↵", "Open", "esc", "Close"])
      assert.ok(lines.includes(hint), `the key hints include ${hint}`);
  } finally {
    dom.window.piBridge = previousBridge;
  }
});

test("typing in the card finds a project by its name or by a folder, and Enter opens the one in view", async (t) => {
  const opened = [];
  const { props } = baseProps({
    listedProjects: [
      { root: "/Users/tester/.dexon", missing: false },
      { root: "/work/gamma", missing: false },
      { root: "/srv/tools/beta", missing: false },
    ],
    projectName: (root) => ({ "/work/gamma": "gamma", "/srv/tools/beta": "beta" })[root] ?? "Default space",
    onOpenFolder: (folder) => opened.push(folder),
  });
  const view = await mount(t, NavSidebar, props);
  const card = await cardFromHeader(view);
  const search = cardSearch(card);
  await input(search, "GAMMA");
  assert.deepEqual(allByRole(card, "menuitem").map(accessibleName), ["gamma", ...CARD_ACTIONS]);
  assert.equal(cardHighlight(card), "gamma", "the first match is highlighted while searching");
  await input(search, "srv/tools");
  assert.deepEqual(
    allByRole(card, "menuitem").map(accessibleName),
    ["beta", ...CARD_ACTIONS],
    "a folder fragment finds the project that lives there",
  );
  assert.equal(cardHighlight(card), "beta", "the project the folder belongs to is highlighted");
  await keyDown(search, "Enter");
  assert.deepEqual(opened, ["/srv/tools/beta"], "Enter opens the project in view");
  assert.equal(allByRole(dom.window.document.body, "menu").length, 0, "opening a project closes the card");
});

test("typing an existing folder path offers to open it, and Enter opens the folder the Host resolved", async (t) => {
  const opened = [];
  const { props } = baseProps({
    inspectFolder: async (typed) => (typed === "~/code/new-app" ? "/Users/tester/code/new-app" : null),
    onOpenFolder: (folder) => opened.push(folder),
  });
  const view = await mount(t, NavSidebar, props);
  const card = await cardFromHeader(view);
  const search = cardSearch(card);
  await input(search, "~/code/new-app");
  await waitFor(() => assert.equal(accessibleName(allByRole(card, "menuitem")[0]), "Open ~/code/new-app"));
  await keyDown(search, "Enter");
  assert.deepEqual(opened, ["/Users/tester/code/new-app"], "Enter opens the folder the Host resolved");
});

test("a missing folder is never offered, an empty match says so, and a card opened again starts empty", async (t) => {
  const opened = [];
  const { props } = baseProps({ inspectFolder: async () => null, onOpenFolder: (folder) => opened.push(folder) });
  const view = await mount(t, NavSidebar, props);
  let card = await cardFromHeader(view);
  const search = cardSearch(card);
  await input(search, "~/code/missing");
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  assert.deepEqual(
    allByRole(card, "menuitem").map(accessibleName),
    CARD_ACTIONS,
    "no open-folder row for a folder that is not there",
  );
  assert.match(card.textContent, /No matching projects/, "the card says nothing matched");
  await keyDown(search, "Escape");
  card = await cardFromHeader(view);
  assert.equal(cardSearch(card).value, "", "the search box starts empty again");
  await keyDown(cardSearch(card), "Enter");
  assert.deepEqual(opened, [], "Enter with nothing highlighted does nothing");
  assert.equal(allByRole(dom.window.document.body, "menu").length, 1, "the card stays open");
});

test("editing the text after a folder was offered drops the offer at once, so Enter never opens the old folder", async (t) => {
  const opened = [];
  const { props } = baseProps({
    listedProjects: [
      { root: "/Users/tester/.dexon", missing: false },
      { root: "/work/gamma", missing: false },
    ],
    projectName: (root) => (root === "/work/gamma" ? "gamma" : "Default space"),
    inspectFolder: async (typed) => (typed === "~/code/new-app" ? "/Users/tester/code/new-app" : null),
    onOpenFolder: (folder) => opened.push(folder),
  });
  const view = await mount(t, NavSidebar, props);
  const card = await cardFromHeader(view);
  const search = cardSearch(card);
  await input(search, "~/code/new-app");
  await waitFor(() => assert.equal(accessibleName(allByRole(card, "menuitem")[0]), "Open ~/code/new-app"));
  await input(search, "gamma");
  assert.deepEqual(
    allByRole(card, "menuitem").map(accessibleName),
    ["gamma", ...CARD_ACTIONS],
    "the folder typed before is no longer offered",
  );
  await keyDown(search, "Enter");
  assert.deepEqual(opened, ["/work/gamma"], "Enter opens the project in view, never the folder typed before");
});

test("a late answer for an earlier folder path never becomes the offer for the text typed now", async (t) => {
  let answer;
  const opened = [];
  const { props } = baseProps({
    inspectFolder: (typed) =>
      typed === "/opt/shared"
        ? new Promise((resolve) => (answer = () => resolve("/opt/shared")))
        : Promise.resolve(typed === "~/code/new-app" ? "/Users/tester/code/new-app" : null),
    onOpenFolder: (folder) => opened.push(folder),
  });
  const view = await mount(t, NavSidebar, props);
  const card = await cardFromHeader(view);
  const search = cardSearch(card);
  await input(search, "/opt/shared");
  await waitFor(() => assert.ok(answer, "the folder check started"));
  await input(search, "~/code/new-app");
  await waitFor(() => assert.equal(accessibleName(allByRole(card, "menuitem")[0]), "Open ~/code/new-app"));
  await act(async () => answer());
  assert.deepEqual(
    allByRole(card, "menuitem").map(accessibleName),
    ["Open ~/code/new-app", ...CARD_ACTIONS],
    "only the folder typed now is offered; the late answer for the earlier path is dropped",
  );
  await keyDown(search, "Enter");
  assert.deepEqual(
    opened,
    ["/Users/tester/code/new-app"],
    "Enter opens the folder typed now, not the one answered late",
  );
});

test("sessions are grouped under the project they belong to and other projects start folded", async (t) => {
  const sessions = [
    ...navigationSessions,
    {
      ...navigationSessions[2],
      id: "sess-gamma",
      name: "gamma elsewhere",
      cwd: "/work/gamma",
      projectRoot: "/work/gamma",
    },
  ];
  const { props } = baseProps({ sessions, spacePath: "/Users/tester/.dexon" });
  const view = await mount(t, NavSidebar, props);
  const current = button(view.container, "Default space");
  const other = button(view.container, "gamma");
  assert.equal(current.getAttribute("aria-expanded"), "true");
  assert.equal(other.getAttribute("aria-expanded"), "false");
  assert.ok(precedes(current, other), "the current project is listed first");
  assert.match(view.container.textContent, /alpha render bug/);
  assert.doesNotMatch(view.container.textContent, /gamma elsewhere/);
  await click(other);
  assert.equal(other.getAttribute("aria-expanded"), "true");
  assert.match(view.container.textContent, /gamma elsewhere/);
  await click(current);
  assert.doesNotMatch(view.container.textContent, /alpha render bug/);
});

test("the active page is marked on the matching main entry only", async (t) => {
  const { props } = baseProps({ page: "resources" });
  const view = await mount(t, NavSidebar, props);
  assert.equal(button(view.container, "Plugins & Skills").getAttribute("aria-current"), "page");
  const newSession = button(view.container, "New session");
  assert.ok(newSession, "the navigation offers an entry named New session");
  assert.equal(newSession.getAttribute("aria-current"), null);
});

test("while Settings is open, the Settings entry is the current page instead of any main entry", async (t) => {
  for (const expanded of [true, false]) {
    const { props } = baseProps({ expanded, page: "resources", settingsOpen: true });
    const view = await mount(t, NavSidebar, props);
    assert.equal(button(view.container, "Settings").getAttribute("aria-current"), "page");
    assert.equal(button(view.container, "Plugins & Skills").getAttribute("aria-current"), null);
    assert.equal(button(view.container, "New session").getAttribute("aria-current"), null);
    await view.unmount();
  }
});

test("collapsed navigation exposes only the four approved entries and no history", async (t) => {
  const { props, calls } = baseProps({ expanded: false });
  const view = await mount(t, NavSidebar, props);
  const controls = [...view.container.querySelectorAll("button")];
  assert.deepEqual(
    controls.map((control) => control.getAttribute("aria-label")),
    ["Show sidebar", "New session", "Plugins & Skills", "Settings"],
  );
  assert.doesNotMatch(view.container.textContent, /History|alpha render bug|Chat/);
  assert.equal(view.container.querySelector("img").getAttribute("aria-hidden"), "true");
  await click(button(view.container, "New session"));
  await click(button(view.container, "Plugins & Skills"));
  await click(button(view.container, "Settings"));
  assert.equal(calls.newSession, 1);
  assert.deepEqual(calls.navigate, ["resources"]);
  assert.equal(calls.settings, 1);
});

test("collapsing and expanding navigation through its buttons resets the session search", async (t) => {
  const { props } = baseProps();
  function NavigationOwner() {
    const [expanded, setExpanded] = useState(true);
    return createElement(NavSidebar, { ...props, expanded, onToggleExpanded: () => setExpanded((value) => !value) });
  }
  const view = await mount(t, NavigationOwner);
  const search = view.container.querySelector('input[type="search"]');
  await input(search, "beta");
  assert.match(view.container.textContent, /beta unrelated/);
  assert.doesNotMatch(view.container.textContent, /alpha render bug/);
  await click(button(view.container, "Hide sidebar"));
  assert.equal(view.container.querySelector('input[type="search"]'), null);
  await click(button(view.container, "Show sidebar"));
  assert.equal(view.container.querySelector('input[type="search"]').value, "");
  assert.match(view.container.textContent, /alpha render bug/);
  assert.match(view.container.textContent, /beta unrelated/);
});
