import { realRendererGraphOptions } from "../renderer-real-graph.mjs";
import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test, { after } from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

const projectRoot = path.resolve(import.meta.dirname, "../../../..");

const { ProjectSessionList, SessionListStatus } = await importTestBundle("session-sidebar-session-groups", {
  stdin: {
    contents:
      'export { ProjectSessionList, SessionListStatus } from "./src/renderer/components/session-sidebar/session-groups.tsx";',
    resolveDir: projectRoot,
    sourcefile: "session-groups-test-entry.tsx",
    loader: "tsx",
  },
  tsconfig: path.join(projectRoot, "tsconfig.renderer.json"),
  external: ["react", "react-dom", "react-dom/*"],
  ...realRendererGraphOptions(projectRoot),
});

const GLOBAL_NAMES = ["window", "fetch", "IS_REACT_ACT_ENVIRONMENT"];

function installWindowStub() {
  const originals = new Map(GLOBAL_NAMES.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  globalThis.window = {
    requestAnimationFrame: (callback) => {
      callback(0);
      return 1;
    },
    cancelAnimationFrame: () => {},
    setTimeout,
    clearTimeout,
    alert: () => {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  return () => {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  };
}

// Review F1 (round 2): the component's sessionDateGroup() reads the real
// clock as its default parameter, so the fixtures and the component must read
// the SAME controlled clock — otherwise a midnight straddling the two reads
// flips "today" into "yesterday". Pin Date for this whole test process (the
// runner measures durations with hrtime, so the report is unaffected).
const REAL_DATE = Date;
const FIXED_NOW = REAL_DATE.parse("2026-09-15T10:30:00.000Z");
class FixedDate extends REAL_DATE {
  constructor(...args) {
    // `new Date(undefined)` must behave like the no-arg form (production code
    // passes possibly-undefined values through).
    if (args.length === 0 || (args.length === 1 && args[0] === undefined)) super(FIXED_NOW);
    else super(...args);
  }
  static now() {
    return FIXED_NOW;
  }
}
globalThis.Date = FixedDate;
after(() => {
  globalThis.Date = REAL_DATE;
});

// Group fixtures anchor to LOCAL CALENDAR boundaries of the controlled clock
// (review R5): "today" sits exactly at the local midnight of the pinned day
// and the other groups count whole calendar days back, so membership is
// identical at any wall-clock time or time zone.
const todayStart = new Date(FIXED_NOW);
todayStart.setHours(0, 0, 0, 0);

function daysAgoAtMidnight(days) {
  const date = new Date(todayStart);
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function sessionFixture(id, overrides = {}) {
  return {
    path: `/sessions/${id}.json`,
    id,
    name: "",
    firstMessage: `First message of ${id}`,
    cwd: "/Users/tester/.dexon",
    created: daysAgoAtMidnight(3),
    modified: daysAgoAtMidnight(2),
    messageCount: 2,
    ...overrides,
  };
}

function viewProps(overrides = {}) {
  return {
    sessions: [],
    selectedSessionId: null,
    runningSessionIds: new Set(),
    unreadSessionIds: new Set(),
    homeDir: "/Users/tester",
    onSelectSession: () => {},
    onRenamed: () => {},
    onSessionDeleted: () => {},
    ...overrides,
  };
}

async function renderView(props, component = ProjectSessionList) {
  let renderer;
  await act(async () => {
    renderer = create(createElement(component, props));
  });
  return renderer;
}

function textOf(root) {
  const parts = [];
  for (const node of root.root.findAll((item) => typeof item.type === "string")) {
    for (const child of node.children ?? []) {
      if (typeof child === "string") parts.push(child);
    }
  }
  return parts;
}

test("a project's sessions render as one list along a single guide line, newest tree first", async () => {
  const restore = installWindowStub();
  let root;
  try {
    const sessions = [
      sessionFixture("older-1", { name: "older session", modified: daysAgoAtMidnight(30) }),
      sessionFixture("today-1", { name: "today session", modified: todayStart.toISOString() }),
      sessionFixture("recent-1", { name: "recent session", modified: daysAgoAtMidnight(2) }),
    ];
    root = await renderView(viewProps({ sessions }));
    const lists = root.root.findAll((node) => node.type === "div" && node.props.role === "list");
    assert.equal(lists.length, 1, "the project shows one list, not one per date");
    const text = textOf(root).join("\n");
    for (const label of ["Today", "Last 7 days", "Older"]) {
      assert.doesNotMatch(text, new RegExp(label), `no date heading ${label}`);
    }
    const order = ["today session", "recent session", "older session"].map((name) => text.indexOf(name));
    assert.ok(
      order.every((index) => index >= 0),
      "every session renders",
    );
    assert.ok(order[0] < order[1] && order[1] < order[2], "trees are ordered by their newest activity");
  } finally {
    root?.unmount?.();
    restore();
  }
});

test("child sessions start collapsed and expand after their parent on request", async () => {
  const restore = installWindowStub();
  let root;
  try {
    const parent = sessionFixture("parent-1", { name: "parent session", modified: todayStart.toISOString() });
    const child = sessionFixture("child-1", {
      name: "child session",
      parentSessionId: "parent-1",
      modified: daysAgoAtMidnight(0),
    });
    root = await renderView(viewProps({ sessions: [child, parent] }));
    assert.doesNotMatch(textOf(root).join("\n"), /child session/, "children start hidden");
    await act(async () => {
      root.root.findByProps({ "aria-label": "Expand forks" }).props.onClick({ stopPropagation() {} });
    });
    const flat = textOf(root).join("\n");
    const parentIndex = flat.indexOf("parent session");
    const childIndex = flat.indexOf("child session");
    assert.ok(parentIndex >= 0 && childIndex >= 0, "both rows must render");
    assert.ok(childIndex > parentIndex, "the child must render after its parent");
  } finally {
    root?.unmount?.();
    restore();
  }
});

test("rows keep the order their sessions were created in", async () => {
  const restore = installWindowStub();
  let root;
  try {
    const parent = sessionFixture("sort-parent", {
      name: "parent of both",
      created: daysAgoAtMidnight(6),
      modified: daysAgoAtMidnight(6),
    });
    const older = sessionFixture("sort-old", {
      name: "older first written",
      parentSessionId: "sort-parent",
      created: daysAgoAtMidnight(3),
      modified: todayStart.toISOString(),
    });
    const newer = sessionFixture("sort-new", {
      name: "newer second written",
      parentSessionId: "sort-parent",
      created: daysAgoAtMidnight(2),
      modified: new Date(todayStart.getTime() + 1).toISOString(),
    });
    root = await renderView(viewProps({ sessions: [newer, older, parent] }));
    await act(async () => {
      root.root.findByProps({ "aria-label": "Expand forks" }).props.onClick({ stopPropagation() {} });
    });
    const flat = textOf(root).join("\n");
    const newerIndex = flat.indexOf("newer second written");
    const olderIndex = flat.indexOf("older first written");
    assert.ok(newerIndex >= 0 && olderIndex >= 0, "both rows must render");
    assert.ok(olderIndex < newerIndex, "the session created first renders first even when it was modified last");
  } finally {
    root?.unmount?.();
    restore();
  }
});

function visibleSessionIds(root) {
  return root.root
    .findAll((node) => node.type === "div" && node.props.role === "listitem")
    .map((node) => node.props["data-session-id"]);
}

test("an old project starts with its five newest root trees", async () => {
  const restore = installWindowStub();
  let root;
  try {
    const sessions = [10, 9, 8, 7, 6, 5, 4].map((day) =>
      sessionFixture(`old-${day}`, { modified: `2026-09-${String(day).padStart(2, "0")}T00:00:00.000Z` }),
    );
    root = await renderView(viewProps({ sessions }));
    assert.deepEqual(visibleSessionIds(root), ["old-10", "old-9", "old-8", "old-7", "old-6"]);
  } finally {
    await act(async () => root?.unmount());
    restore();
  }
});

test("the 72-hour window includes its exact boundary and every recent root beyond five", async () => {
  const restore = installWindowStub();
  let root;
  try {
    const sessions = [
      sessionFixture("recent-a", { modified: "2026-09-15T09:00:00.000Z" }),
      sessionFixture("recent-b", { modified: "2026-09-15T08:00:00.000Z" }),
      sessionFixture("recent-c", { modified: "2026-09-14T12:00:00.000Z" }),
      sessionFixture("recent-d", { modified: "2026-09-13T12:00:00.000Z" }),
      sessionFixture("recent-e", { modified: "2026-09-12T11:00:00.000Z" }),
      sessionFixture("boundary", { modified: "2026-09-12T10:30:00.000Z" }),
      sessionFixture("too-old", { modified: "2026-09-12T10:29:59.999Z" }),
      sessionFixture("invalid", { modified: "0000-invalid" }),
    ];
    root = await renderView(viewProps({ sessions }));
    assert.deepEqual(visibleSessionIds(root), ["recent-a", "recent-b", "recent-c", "recent-d", "recent-e", "boundary"]);
  } finally {
    await act(async () => root?.unmount());
    restore();
  }
});

test("old trees stay visible for running, waiting, error or unread activity at any depth", async () => {
  const restore = installWindowStub();
  let root;
  try {
    for (const status of ["running", "awaiting_input", "error", "unread"]) {
      for (const depth of [0, 1, 3]) {
        const sessions = [10, 9, 8, 7, 6].map((day) =>
          sessionFixture(`baseline-${day}`, { modified: `2026-09-${String(day).padStart(2, "0")}T00:00:00.000Z` }),
        );
        sessions.push(sessionFixture("active-root", { modified: "2026-08-01T00:00:00.000Z" }));
        let activeId = "active-root";
        for (let level = 1; level <= depth; level += 1) {
          const id = `active-${level}`;
          sessions.push(
            sessionFixture(id, { parentSessionId: activeId, relation: "fork", modified: "2026-08-01T00:00:00.000Z" }),
          );
          activeId = id;
        }
        root = await renderView(
          viewProps({
            sessions,
            activity: { of: (id) => (id === activeId ? status : "idle"), runAge: () => ({ kind: "not-running" }) },
          }),
        );
        assert.deepEqual(
          visibleSessionIds(root),
          ["baseline-10", "baseline-9", "baseline-8", "baseline-7", "baseline-6", "active-root"],
          `${status} at depth ${depth} keeps its tree`,
        );
        await act(async () => root.unmount());
        root = null;
      }
    }
  } finally {
    await act(async () => root?.unmount());
    restore();
  }
});

test("an old selected root or descendant keeps its root tree visible without loading unrelated roots", async () => {
  const restore = installWindowStub();
  let root;
  try {
    const sessions = [10, 9, 8, 7, 6].map((day) =>
      sessionFixture(`baseline-${day}`, { modified: `2026-09-${String(day).padStart(2, "0")}T00:00:00.000Z` }),
    );
    sessions.push(
      sessionFixture("selected-root", { modified: "2026-08-01T00:00:00.000Z" }),
      sessionFixture("selected-middle", { parentSessionId: "selected-root", modified: "2026-08-01T00:00:00.000Z" }),
      sessionFixture("selected-deep", { parentSessionId: "selected-middle", modified: "2026-08-01T00:00:00.000Z" }),
      sessionFixture("unrelated-old", { modified: "2026-07-01T00:00:00.000Z" }),
    );
    for (const selectedSessionId of ["selected-root", "selected-deep"]) {
      root = await renderView(viewProps({ sessions, selectedSessionId }));
      assert.deepEqual(visibleSessionIds(root), [
        "baseline-10",
        "baseline-9",
        "baseline-8",
        "baseline-7",
        "baseline-6",
        "selected-root",
      ]);
      await act(async () => root.unmount());
      root = null;
    }
  } finally {
    await act(async () => root?.unmount());
    restore();
  }
});

test("Load more shows the remaining root count and reveals all remaining roots in one click", async () => {
  const restore = installWindowStub();
  let root;
  try {
    const sessions = Array.from({ length: 12 }, (_, index) =>
      sessionFixture(`root-${index + 1}`, { modified: `2026-08-${String(31 - index).padStart(2, "0")}T00:00:00.000Z` }),
    );
    root = await renderView(viewProps({ sessions }));
    const buttons = root.root.findAll(
      (node) => node.type === "button" && node.props["aria-label"] === "Load more sessions",
    );
    assert.equal(buttons.length, 1, "a project with hidden roots offers Load more");
    assert.equal(buttons[0].findByProps({ className: "type-mono-meta" }).children.join(""), "7");
    await act(async () => buttons[0].props.onClick());
    assert.deepEqual(visibleSessionIds(root), [
      "root-1",
      "root-2",
      "root-3",
      "root-4",
      "root-5",
      "root-6",
      "root-7",
      "root-8",
      "root-9",
      "root-10",
      "root-11",
      "root-12",
    ]);
    assert.equal(
      root.root.findAll((node) => node.type === "button" && node.props["aria-label"] === "Load more sessions").length,
      0,
    );
  } finally {
    await act(async () => root?.unmount());
    restore();
  }
});

test("loading and error states render their own messages", async () => {
  const restore = installWindowStub();
  let root;
  try {
    const status = (props) =>
      renderView({ empty: false, hasActiveFilter: false, loading: false, error: null, ...props }, SessionListStatus);
    root = await status({ loading: true });
    assert.match(textOf(root).join("\n"), /Loading/, "loading state must render while fetching");

    await root.unmount();
    root = await status({ error: "Session list failed to load" });
    assert.match(textOf(root).join("\n"), /Session list failed to load/, "error state must surface the load failure");
  } finally {
    root?.unmount?.();
    restore();
  }
});

test("empty states distinguish a filtered search from an empty directory", async () => {
  const restore = installWindowStub();
  let root;
  try {
    const status = (props) =>
      renderView({ empty: true, hasActiveFilter: false, loading: false, error: null, ...props }, SessionListStatus);
    root = await status({ hasActiveFilter: true });
    assert.match(textOf(root).join("\n"), /No matching sessions/, "filtered empty state must be explicit");

    await root.unmount();
    root = await status({});
    assert.match(textOf(root).join("\n"), /No sessions found/, "empty directory state must be explicit");
  } finally {
    root?.unmount?.();
    restore();
  }
});
