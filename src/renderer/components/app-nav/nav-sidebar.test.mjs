import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  button,
  byRole,
  click,
  createElement,
  input,
  loadRenderer,
  mount,
  restoreGlobals,
} from "../../../../tests/support/renderer.mjs";
import { allByRole, precedes } from "../../../../tests/support/dom-queries.mjs";
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
      spaceName: "Personal space",
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
      onOpenFolder: () => {},
      onChooseFolder: () => {},
      onSwitchSpace: () => {},
      onBackToPersonalSpace: () => {},
      ...overrides,
    },
    calls,
  };
}

test("expanded navigation presents space, main entries, history and settings", async (t) => {
  const { props } = baseProps();
  const view = await mount(t, NavSidebar, props);
  assert.ok(button(view.container, "Hide sidebar"));
  assert.ok(byRole(view.container, "searchbox", "Search sessions"), "the session search is always visible");
  assert.ok(button(view.container, "Actions for Personal space"), "the current project offers its space actions");
  assert.match(view.container.textContent, /Personal space/);
  const newSession = button(view.container, "New session");
  assert.ok(newSession, "the navigation offers an entry named New session");
  assert.equal(newSession.getAttribute("aria-current"), null);
  assert.equal(button(view.container, "Plugins & Skills").getAttribute("aria-current"), null);
  for (const label of ["Add project space from folder…", "Settings"]) assert.ok(button(view.container, label));
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
  await click(button(projects, "Add project space from folder…"));
  assert.equal(chosen, 1);
  assert.equal(calls.newSession, 0);
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
  const current = button(view.container, "Personal space");
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
