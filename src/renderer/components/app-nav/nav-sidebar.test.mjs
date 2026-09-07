import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

// Phase 4 contract tests for the new app navigation sidebar: geometry
// (224px expanded / 52px icon rail), the four regions, the collapsed rail's
// exactly-four entries, on-demand search reset on collapse, long-text
// ellipsis, and the presentation-only boundary (no api-client imports).

const projectRoot = path.resolve(import.meta.dirname, "../../../..");

const { NavSidebar, NAV_EXPANDED_WIDTH, NAV_RAIL_WIDTH } = await importTestBundle("app-nav-sidebar", {
  stdin: {
    contents:
      'export { NavSidebar, NAV_EXPANDED_WIDTH, NAV_RAIL_WIDTH } from "./src/renderer/components/app-nav/nav-sidebar.tsx";',
    resolveDir: projectRoot,
    sourcefile: "app-nav-sidebar-test-entry.tsx",
    loader: "tsx",
  },
  tsconfig: path.join(projectRoot, "tsconfig.renderer.json"),
  external: ["react", "react-dom", "react-dom/*"],
  plugins: [
    {
      name: "app-nav-sidebar-stubs",
      setup(build) {
        build.onResolve({ filter: /^@\/i18n$/ }, () => ({ path: "i18n", namespace: "app-nav-sidebar" }));
        build.onResolve({ filter: /\.png$/ }, () => ({ path: "png", namespace: "app-nav-sidebar" }));
        build.onLoad({ filter: /.*/, namespace: "app-nav-sidebar" }, ({ path: modulePath }) => ({
          contents:
            modulePath === "i18n"
              ? "function stubT(_key, fallback) { return fallback; }\n" +
                'export function useI18n() { return { language: "en", t: stubT }; }'
              : 'export default "data:image/png;base64,";',
          loader: "js",
        }));
      },
    },
  ],
});

// Session rows (SessionItem) touch window timers in effects; the sidebar
// never fetches during render, so a minimal window stub is sufficient.
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

function sessionFixture(id, overrides = {}) {
  return {
    path: `/sessions/${id}.json`,
    id,
    name: "",
    firstMessage: `First message of ${id}`,
    cwd: "/Users/tester/.dexon",
    created: "2026-08-01T08:00:00.000Z",
    modified: "2026-09-06T09:00:00.000Z",
    messageCount: 3,
    ...overrides,
  };
}

const SAMPLE_SESSIONS = [
  sessionFixture("sess-alpha", { name: "alpha render bug", modified: "2026-09-06T10:00:00.000Z" }),
  sessionFixture("sess-child", {
    name: "fork follow-up",
    parentSessionId: "sess-alpha",
    modified: "2026-09-06T10:30:00.000Z",
  }),
  sessionFixture("sess-beta", { name: "beta unrelated", modified: "2026-08-20T10:00:00.000Z" }),
];

function baseProps(overrides = {}) {
  const calls = { toggle: 0, navigate: [], select: 0, newSession: 0, refresh: 0, settings: 0 };
  return {
    props: {
      expanded: true,
      page: "chat",
      spaceName: "Personal space",
      spacePath: "~/.dexon",
      sessions: SAMPLE_SESSIONS,
      loading: false,
      error: null,
      selectedSessionId: null,
      runningSessionIds: new Set(),
      unreadSessionIds: new Set(),
      homeDir: "/Users/tester",
      onToggleExpanded: () => {
        calls.toggle += 1;
      },
      onNavigate: (page) => {
        calls.navigate.push(page);
      },
      onSelectSession: () => {
        calls.select += 1;
      },
      onNewSession: () => {
        calls.newSession += 1;
      },
      onRefreshSessions: () => {
        calls.refresh += 1;
      },
      onOpenSettings: () => {
        calls.settings += 1;
      },
      onOpenFolder: () => {},
      onChooseFolder: () => {},
      onSwitchSpace: () => {},
      onBackToPersonalSpace: () => {},
      ...overrides,
    },
    calls,
  };
}

function hostNodes(root) {
  return root.root.findAll((node) => typeof node.type === "string");
}

function buttonsOf(root) {
  return hostNodes(root).filter((node) => node.type === "button");
}

function textOf(root) {
  const parts = [];
  for (const node of hostNodes(root)) {
    for (const child of node.children ?? []) {
      if (typeof child === "string") parts.push(child);
    }
  }
  return parts.join("\n");
}

function findByLabel(root, label) {
  const matches = hostNodes(root).filter((node) => node.props["aria-label"] === label);
  assert.ok(matches.length > 0, `expected an element with aria-label ${JSON.stringify(label)}`);
  return matches;
}

async function renderSidebar(props) {
  let renderer;
  await act(async () => {
    renderer = create(createElement(NavSidebar, props));
  });
  return renderer;
}

test("expanded sidebar is 224px wide and lays out the four regions", async () => {
  const restore = installWindowStub();
  let root;
  try {
    assert.equal(NAV_EXPANDED_WIDTH, 224, "expanded width constant must be the approved 224px");
    const { props } = baseProps();
    root = await renderSidebar(props);
    const tree = root.toJSON();
    assert.equal(tree.type, "div", "NavSidebar renders a single root container");
    assert.equal(tree.props.style.width, 224, "expanded sidebar width must be 224px");

    findByLabel(root, "Hide sidebar"); // top region: collapse toggle
    const nameButton = hostNodes(root).find((node) => node.props["aria-haspopup"] === "menu");
    assert.ok(nameButton, "top region must expose the space menu trigger");
    assert.match(textOf(root), /Personal space/);

    const chatEntry = findByLabel(root, "Chat")[0];
    assert.equal(chatEntry.props["aria-current"], "page", "chat must be the active main entry");
    const resourcesEntry = findByLabel(root, "Plugins & Skills")[0];
    assert.equal(resourcesEntry.props["aria-current"], undefined);

    findByLabel(root, "Search sessions"); // history region: on-demand search
    findByLabel(root, "Refresh"); // history region: manual refresh
    findByLabel(root, "new session"); // history region: new session (shared fallback)
    assert.match(textOf(root), /History/, "history region title must be visible when expanded");

    findByLabel(root, "Settings"); // bottom region
    assert.match(textOf(root), /alpha render bug/, "session rows must render when expanded");
  } finally {
    root?.unmount?.();
    restore();
  }
});

test("the active page is marked on the matching main entry only", async () => {
  const restore = installWindowStub();
  let root;
  try {
    const { props } = baseProps({ page: "resources" });
    root = await renderSidebar(props);
    const chatEntry = findByLabel(root, "Chat")[0];
    const resourcesEntry = findByLabel(root, "Plugins & Skills")[0];
    assert.equal(resourcesEntry.props["aria-current"], "page");
    assert.equal(chatEntry.props["aria-current"], undefined);
  } finally {
    root?.unmount?.();
    restore();
  }
});

test("collapsed rail is 52px with exactly four interactive entries and no history", async () => {
  const restore = installWindowStub();
  let root;
  try {
    assert.equal(NAV_RAIL_WIDTH, 52, "rail width constant must be the approved 52px");
    const { props } = baseProps({ expanded: false });
    root = await renderSidebar(props);
    const tree = root.toJSON();
    assert.equal(tree.props.style.width, 52, "collapsed rail width must be 52px");

    const buttons = buttonsOf(root);
    assert.equal(
      buttons.length,
      4,
      `the rail must expose exactly the four approved entries, found: ${buttons
        .map((button) => button.props["aria-label"])
        .join(", ")}`,
    );
    assert.deepEqual(
      buttons.map((button) => button.props["aria-label"]),
      ["Show sidebar", "new session", "Plugins & Skills", "Settings"],
      "rail entries keep stable positions: expand, new session, plugins & skills, settings",
    );

    assert.doesNotMatch(textOf(root), /History/, "history must be absent when collapsed");
    assert.doesNotMatch(textOf(root), /alpha render bug/, "session rows must be absent when collapsed");
    assert.doesNotMatch(textOf(root), /Chat/, "the chat entry must be absent when collapsed");

    const icon = hostNodes(root).find((node) => node.type === "img");
    assert.ok(icon, "the decorative app icon stays visible on the rail");
    assert.equal(String(icon.props["aria-hidden"]), "true", "the app icon must be decorative on the rail");
  } finally {
    root?.unmount?.();
    restore();
  }
});

test("expanding the sidebar after a collapse clears the on-demand search", async () => {
  const restore = installWindowStub();
  let root;
  try {
    const { props } = baseProps();
    root = await renderSidebar(props);

    const searchButton = findByLabel(root, "Search sessions")[0];
    await act(async () => {
      searchButton.props.onClick();
    });
    let input = hostNodes(root).find((node) => node.type === "input" && node.props.type === "search");
    assert.ok(input, "the search input must appear after opening on-demand search");

    await act(async () => {
      input.props.onChange({ target: { value: "beta" } });
    });
    let text = textOf(root);
    assert.match(text, /beta unrelated/, "matching session stays visible while filtering");
    assert.doesNotMatch(text, /alpha render bug/, "non-matching sessions are filtered out");

    await act(async () => {
      root.update(createElement(NavSidebar, baseProps({ expanded: false }).props));
    });
    await act(async () => {
      root.update(createElement(NavSidebar, baseProps().props));
    });

    input = hostNodes(root).find((node) => node.type === "input" && node.props.type === "search");
    assert.equal(input, undefined, "search must start closed again after collapse+expand");
    text = textOf(root);
    assert.match(text, /beta unrelated/, "the filter must be cleared after collapsing the sidebar");
    assert.match(text, /alpha render bug/, "the full list must be visible again after collapsing");
  } finally {
    root?.unmount?.();
    restore();
  }
});

test("the space name is ellipsified instead of breaking the top row", async () => {
  const restore = installWindowStub();
  let root;
  try {
    const longName = "一个非常非常长的空间名称会在这里显示省略号而不是撑破布局";
    const { props } = baseProps({ spaceName: longName });
    root = await renderSidebar(props);
    const nameHost = hostNodes(root).find(
      (node) =>
        (node.children ?? []).some((child) => typeof child === "string" && child.includes("空间名称")) &&
        node.props.style?.textOverflow === "ellipsis",
    );
    assert.ok(nameHost, "the space name must render inside an ellipsified container");
  } finally {
    root?.unmount?.();
    restore();
  }
});

test("nav components stay presentation-only and import no api client", () => {
  const navDir = path.join(projectRoot, "src/renderer/components/app-nav");
  assert.ok(existsSync(navDir), "the app-nav directory must exist for this contract");
  const files = [];
  const collect = (entry) => {
    if (statSync(entry).isDirectory()) {
      for (const name of readdirSync(entry)) collect(path.join(entry, name));
      return;
    }
    if (/\.(?:ts|tsx)$/.test(entry)) files.push(entry);
  };
  collect(navDir);
  assert.ok(files.length >= 4, `expected the nav component modules, found ${files.length}`);
  const offenders = files.filter((file) => /api-client/.test(readFileSync(file, "utf8")));
  assert.deepEqual(
    offenders.map((file) => path.relative(projectRoot, file)),
    [],
    "nav presentation components must not import the api client (data arrives via props)",
  );
});
