import { realRendererGraphOptions } from "../renderer-real-graph.mjs";
import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test, { after } from "node:test";
// The DOM environment must be evaluated before react and react-dom so their
// module-level feature detection sees a realistic browser (fixture contract).
import { dom, createManagedDomRoot, restoreGlobals } from "../resource-dom-environment.mjs";
import { click, input as enterText, keyDown } from "../../../../tests/support/dom-events.mjs";
import { createElement } from "react";

// Phase 4 contract tests for the on-demand session search inside the new
// navigation history region: closed until the header icon is used, focused on
// open, filtering across the five approved fields with hit ancestors, and the
// two explicit close paths that both clear the filter.

after(() => {
  restoreGlobals();
});

const projectRoot = path.resolve(import.meta.dirname, "../../../..");

const { NavHistory } = await importTestBundle("app-nav-history", {
  stdin: {
    contents: 'export { NavHistory } from "./src/renderer/components/app-nav/nav-history.tsx";',
    resolveDir: projectRoot,
    sourcefile: "app-nav-history-test-entry.tsx",
    loader: "tsx",
  },
  tsconfig: path.join(projectRoot, "tsconfig.renderer.json"),
  external: ["react", "react-dom", "react-dom/*"],
  ...realRendererGraphOptions(projectRoot),
});

const NOW = new Date();

function iso(offsetHours) {
  return new Date(NOW.getTime() - offsetHours * 3_600_000).toISOString();
}

function sessionFixture(id, overrides = {}) {
  return {
    path: `/sessions/${id}.json`,
    id,
    name: "",
    firstMessage: `First message of ${id}`,
    cwd: "/Users/tester/.dexon",
    created: iso(72),
    modified: iso(24),
    messageCount: 2,
    ...overrides,
  };
}

// A stable cast covering every approved search field and one three-level
// parent chain: root → mid → deep.
const CAST = [
  sessionFixture("sess-alpha", { name: "alpha render bug", modified: iso(2) }),
  sessionFixture("sess-beta", { name: "unrelated neighbour", modified: iso(3) }),
  sessionFixture("sess-by-id", { name: "quiet one", modified: iso(4) }),
  sessionFixture("sess-qq99", { name: "id marker", modified: iso(5) }),
  sessionFixture("sess-cwd", { name: "cwd marker", cwd: "/tmp/proj-unique42", modified: iso(6) }),
  sessionFixture("sess-branch", { name: "branch marker", worktreeBranch: "feature-x", modified: iso(7) }),
  sessionFixture("sess-root", { name: "root plain", modified: iso(8) }),
  sessionFixture("sess-mid", { name: "mid plain", parentSessionId: "sess-root", modified: iso(9) }),
  sessionFixture("sess-deep", {
    name: "deep leaf",
    parentSessionId: "sess-mid",
    firstMessage: "contains deephit token",
    modified: iso(10),
  }),
];

function historyProps(overrides = {}) {
  return {
    sessions: CAST,
    loading: false,
    error: null,
    selectedSessionId: null,
    runningSessionIds: new Set(),
    unreadSessionIds: new Set(),
    homeDir: "/Users/tester",
    onSelectSession: () => {},
    onRenamed: () => {},
    onSessionDeleted: () => {},
    onNewSession: () => {},
    onRefreshSessions: () => {},
    ...overrides,
  };
}

function queryAll(root, selector) {
  return Array.from(root.container.querySelectorAll(selector));
}

function visibleTitles(root) {
  return queryAll(root, "[role='listitem']")
    .map((row) => row.textContent ?? "")
    .filter((text) => text.trim().length > 0);
}

async function openSearch(root) {
  const toggle = root.container.querySelector('[aria-label="Search sessions"]');
  assert.ok(toggle, "the history header must expose the on-demand search trigger");
  await click(toggle);
  return root.container.querySelector('input[type="search"]');
}

async function type(_root, input, value) {
  await enterText(input, value);
}

test("search stays closed until the header icon opens it, then it is focused", async () => {
  const root = createManagedDomRoot();
  try {
    await root.render(createElement(NavHistory, historyProps()));
    assert.equal(root.container.querySelector('input[type="search"]'), null, "search must start closed");

    const input = await openSearch(root);
    assert.ok(input, "the search input must appear after opening");
    assert.equal(dom.window.document.activeElement, input, "the search input must take focus on open");
  } finally {
    await root.unmount();
  }
});

test("filtering matches names and first messages", async () => {
  const root = createManagedDomRoot();
  try {
    await root.render(createElement(NavHistory, historyProps()));
    const input = await openSearch(root);
    await type(root, input, "render");

    const titles = visibleTitles(root);
    assert.ok(
      titles.some((title) => title.includes("alpha render bug")),
      "a name hit must stay visible",
    );
    assert.ok(
      titles.every((title) => !title.includes("unrelated neighbour")),
      "non-matching rows must hide",
    );
    assert.ok(titles.length < CAST.length, "the filter must narrow the list");
  } finally {
    await root.unmount();
  }
});

test("filtering matches the five approved fields: id, cwd and branch", async () => {
  const root = createManagedDomRoot();
  try {
    await root.render(createElement(NavHistory, historyProps()));

    for (const [query, expectedTitle] of [
      ["qq99", "id marker"],
      ["proj-unique42", "cwd marker"],
      ["feature-x", "branch marker"],
    ]) {
      const input = await openSearch(root);
      await type(root, input, query);
      const titles = visibleTitles(root);
      assert.ok(
        titles.some((title) => title.includes(expectedTitle)),
        `query ${JSON.stringify(query)} must surface the ${expectedTitle} row`,
      );
      // Close via the explicit clear button before the next field.
      const clear = root.container.querySelector('[aria-label="Clear session search"]');
      await click(clear);
    }
  } finally {
    await root.unmount();
  }
});

test("a deep hit keeps its whole ancestor chain visible", async () => {
  const root = createManagedDomRoot();
  try {
    await root.render(createElement(NavHistory, historyProps()));
    const input = await openSearch(root);
    await type(root, input, "deephit");

    const titles = visibleTitles(root);
    for (const expected of ["root plain", "mid plain", "deep leaf"]) {
      assert.ok(
        titles.some((title) => title.includes(expected)),
        `hit ancestors must stay visible, missing: ${expected}`,
      );
    }
    assert.doesNotMatch(titles.join("\n"), /alpha render bug/, "unrelated rows must stay hidden");
  } finally {
    await root.unmount();
  }
});

test("the clear button empties the filter and closes the search", async () => {
  const root = createManagedDomRoot();
  try {
    await root.render(createElement(NavHistory, historyProps()));
    const input = await openSearch(root);
    await type(root, input, "render");
    assert.ok(visibleTitles(root).length < CAST.length, "the filter must narrow the list first");

    const clear = root.container.querySelector('[aria-label="Clear session search"]');
    await click(clear);

    assert.equal(root.container.querySelector('input[type="search"]'), null, "the search must close");
    assert.equal(visibleTitles(root).length, CAST.length, "the full list must be restored");
  } finally {
    await root.unmount();
  }
});

test("Escape inside the input closes the search and clears the filter", async () => {
  const root = createManagedDomRoot();
  try {
    await root.render(createElement(NavHistory, historyProps()));
    const input = await openSearch(root);
    await type(root, input, "render");

    await keyDown(input, "Escape");

    assert.equal(root.container.querySelector('input[type="search"]'), null, "Escape must close the search");
    assert.equal(visibleTitles(root).length, CAST.length, "Escape must clear the filter");
  } finally {
    await root.unmount();
  }
});
