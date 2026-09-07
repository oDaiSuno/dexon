import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test, { after } from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

// Contract tests for the shared session groups view extracted from the old
// sidebar in Phase 4: three date groups with parent-child nesting, layer
// sorting, and the loading/error/empty states consumed by both the old
// SessionList and the new navigation history.

const projectRoot = path.resolve(import.meta.dirname, "../../../..");

const { SessionGroupsSection } = await importTestBundle("session-sidebar-session-groups", {
  stdin: {
    contents: 'export { SessionGroupsSection } from "./src/renderer/components/session-sidebar/session-groups.tsx";',
    resolveDir: projectRoot,
    sourcefile: "session-groups-test-entry.tsx",
    loader: "tsx",
  },
  tsconfig: path.join(projectRoot, "tsconfig.renderer.json"),
  external: ["react", "react-dom", "react-dom/*"],
  plugins: [
    {
      name: "session-groups-stubs",
      setup(build) {
        build.onResolve({ filter: /^@\/i18n$/ }, () => ({ path: "i18n", namespace: "session-groups" }));
        build.onLoad({ filter: /.*/, namespace: "session-groups" }, () => ({
          contents:
            "function stubT(_key, fallback) { return fallback; }\n" +
            'export function useI18n() { return { language: "en", t: stubT }; }',
          loader: "js",
        }));
      },
    },
  ],
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
const FIXED_NOW = REAL_DATE.parse("2026-09-15T10:30:00");
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
    loading: false,
    error: null,
    hasActiveFilter: false,
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

async function renderView(props) {
  let renderer;
  await act(async () => {
    renderer = create(createElement(SessionGroupsSection, props));
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

test("sessions render under the three date groups in group order", async () => {
  const restore = installWindowStub();
  let root;
  try {
    const sessions = [
      sessionFixture("today-1", { name: "today session", modified: todayStart.toISOString() }),
      sessionFixture("recent-1", { name: "recent session", modified: daysAgoAtMidnight(2) }),
      sessionFixture("older-1", { name: "older session", modified: daysAgoAtMidnight(30) }),
    ];
    root = await renderView(viewProps({ sessions }));
    const text = textOf(root).join("\n");
    for (const label of ["Today", "Last 7 days", "Older"]) {
      assert.match(text, new RegExp(label), `group label ${label} must render`);
    }
    const todayIndex = text.indexOf("Today");
    const recentIndex = text.indexOf("Last 7 days");
    const olderIndex = text.indexOf("Older");
    assert.ok(todayIndex < recentIndex && recentIndex < olderIndex, "groups must render today → recent → older");
    for (const name of ["today session", "recent session", "older session"]) {
      assert.match(text, new RegExp(name));
    }
  } finally {
    root?.unmount?.();
    restore();
  }
});

test("child sessions nest after their parent inside the same group", async () => {
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

test("rows sort newest-first within a layer", async () => {
  const restore = installWindowStub();
  let root;
  try {
    const older = sessionFixture("sort-old", { name: "older first written", modified: todayStart.toISOString() });
    const newer = sessionFixture("sort-new", {
      name: "newer second written",
      modified: new Date(todayStart.getTime() + 1).toISOString(),
    });
    root = await renderView(viewProps({ sessions: [older, newer] }));
    const flat = textOf(root).join("\n");
    const newerIndex = flat.indexOf("newer second written");
    const olderIndex = flat.indexOf("older first written");
    assert.ok(newerIndex >= 0 && olderIndex >= 0, "both rows must render");
    assert.ok(newerIndex < olderIndex, "the newest session must render first within the group");
  } finally {
    root?.unmount?.();
    restore();
  }
});

test("loading and error states render their own messages", async () => {
  const restore = installWindowStub();
  let root;
  try {
    root = await renderView(viewProps({ loading: true }));
    assert.match(textOf(root).join("\n"), /Loading/, "loading state must render while fetching");

    await root.unmount();
    root = await renderView(viewProps({ error: "Session list failed to load" }));
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
    root = await renderView(viewProps({ hasActiveFilter: true }));
    assert.match(textOf(root).join("\n"), /No matching sessions/, "filtered empty state must be explicit");

    await root.unmount();
    root = await renderView(viewProps());
    assert.match(textOf(root).join("\n"), /No sessions found/, "empty directory state must be explicit");
  } finally {
    root?.unmount?.();
    restore();
  }
});
