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
      spacePath: "~/.dexon",
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
  assert.ok(view.container.querySelector('[aria-haspopup="menu"]'));
  assert.match(view.container.textContent, /Personal space/);
  const newSession = button(view.container, "New session");
  assert.ok(newSession, "the navigation offers an entry named New session");
  assert.equal(newSession.getAttribute("aria-current"), null);
  assert.equal(button(view.container, "Plugins & Skills").getAttribute("aria-current"), null);
  for (const label of ["Search sessions", "Refresh", "Settings"]) assert.ok(button(view.container, label));
  assert.match(view.container.textContent, /History/);
  assert.match(view.container.textContent, /alpha render bug/);
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

test("the history header offers search and refresh without a new-session entry", async (t) => {
  const { props, calls } = baseProps();
  const view = await mount(t, NavSidebar, props);
  const history = byRole(view.container, "navigation", "History");
  assert.ok(button(history, "Refresh"));
  assert.equal(allByRole(history, "button", /^new session$/i).length, 0, "history has no new-session entry of its own");
  assert.equal(calls.newSession, 0);
  await click(button(history, "Refresh"));
  assert.equal(calls.refresh, 1);
  await click(button(history, "Search sessions"));
  assert.ok(history.querySelector('input[type="search"]'));
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
  await click(button(view.container, "Search sessions"));
  const search = view.container.querySelector('input[type="search"]');
  await input(search, "beta");
  assert.match(view.container.textContent, /beta unrelated/);
  assert.doesNotMatch(view.container.textContent, /alpha render bug/);
  await click(button(view.container, "Hide sidebar"));
  assert.equal(view.container.querySelector('input[type="search"]'), null);
  await click(button(view.container, "Show sidebar"));
  assert.equal(view.container.querySelector('input[type="search"]'), null);
  assert.match(view.container.textContent, /alpha render bug/);
  assert.match(view.container.textContent, /beta unrelated/);
});

// Width, clipping and overflow are exercised by test:nav-layout-electron with
// the real production styles/fonts. JSDOM does not claim to measure layout.
