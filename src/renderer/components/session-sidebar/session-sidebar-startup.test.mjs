import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test, { after } from "node:test";
import { dom, restoreGlobals } from "./session-sidebar-pickers-dom-setup.mjs";
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";

// Phase 6 behavior characterization for the SessionSidebar startup effect:
// the sidebar must restore an explicit URL session, but it must no longer
// auto-select the most recently active project when no session is requested —
// the startup space decision belongs to the shell's space coordinator.

const projectRoot = path.resolve(import.meta.dirname, "../../../..");

const { SessionSidebar } = await importTestBundle("session-sidebar-startup", {
  stdin: {
    contents: 'export { SessionSidebar } from "./src/renderer/components/SessionSidebar.tsx";',
    resolveDir: projectRoot,
    sourcefile: "session-sidebar-startup-test-entry.tsx",
    loader: "tsx",
  },
  tsconfig: path.join(projectRoot, "tsconfig.renderer.json"),
  external: ["react", "react-dom", "react-dom/*"],
  plugins: [
    {
      name: "session-sidebar-startup-stubs",
      setup(build) {
        build.onResolve({ filter: /(^|\/)api-client$/ }, () => ({ path: "api", namespace: "sidebar-startup" }));
        build.onResolve({ filter: /\.png$/ }, () => ({ path: "png", namespace: "sidebar-startup" }));
        build.onLoad({ filter: /.*/, namespace: "sidebar-startup" }, ({ path: modulePath }) => {
          if (modulePath === "png") {
            return { contents: 'export default "data:image/png;base64,";', loader: "js" };
          }
          return {
            contents:
              "export const subscribeSessionsChanged = async () => () => undefined;\n" +
              "export const call = async (method) => {\n" +
              "  if (method === 'worktrees.list') {\n" +
              "    return { projectRoot: '', isGit: false, isTopLevel: false, worktrees: [] };\n" +
              "  }\n" +
              "  throw new Error('unexpected api-client call: ' + method);\n" +
              "};",
            loader: "js",
          };
        });
      },
    },
  ],
});

function session(id, cwd, modified) {
  return {
    id,
    name: "",
    firstMessage: "",
    cwd,
    projectRoot: null,
    worktreeBranch: null,
    parentSessionId: null,
    modified,
    messageCount: 1,
  };
}

const sessionsFixture = [
  session("s1", "/proj-a", "2026-09-01T10:00:00.000Z"),
  session("s2", "/proj-b", "2026-09-02T10:00:00.000Z"),
  session("s3", "/proj-a", "2026-09-03T10:00:00.000Z"),
];

let originalFetch = null;
let originalEventSource = null;

function installNetwork() {
  originalFetch = globalThis.fetch;
  originalEventSource = globalThis.EventSource;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.startsWith("/api/sessions")) {
      return { ok: true, json: async () => ({ sessions: sessionsFixture, runningSessionIds: [] }) };
    }
    if (target.startsWith("/api/home")) {
      return { ok: true, json: async () => ({ home: "/Users/tester" }) };
    }
    throw new Error(`unexpected fetch: ${target}`);
  };
  globalThis.EventSource = class {
    constructor() {
      this.onmessage = null;
    }

    close() {}
  };
  dom.window.piBridge = {
    onHostRestarted: () => () => undefined,
    onMenu: () => () => undefined,
    onDeepLinkSession: () => () => undefined,
  };
}

function restoreNetwork() {
  globalThis.fetch = originalFetch;
  if (originalEventSource === undefined) delete globalThis.EventSource;
  else globalThis.EventSource = originalEventSource;
  delete dom.window.piBridge;
}

installNetwork();
after(() => {
  restoreNetwork();
  restoreGlobals();
});

function baseProps(overrides = {}) {
  const calls = {
    cwdChanges: [],
    selected: [],
    restoreDone: 0,
  };
  const props = {
    selectedSessionId: null,
    onSelectSession: (value) => calls.selected.push(value),
    onNewSession: () => {},
    initialSessionId: null,
    onInitialRestoreDone: () => {
      calls.restoreDone += 1;
    },
    refreshKey: 0,
    onSessionDeleted: () => {},
    selectedCwd: null,
    onCwdChange: (cwd) => calls.cwdChanges.push(cwd),
    ...overrides,
  };
  return { calls, props };
}

async function settle(rounds = 6) {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function mountSidebar(props) {
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(SessionSidebar, props));
  });
  return {
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

test("startup without a session link no longer auto-selects the most recent project", async () => {
  const { calls, props } = baseProps();
  const mounted = await mountSidebar(props);
  await settle();

  assert.deepEqual(calls.cwdChanges, []);
  assert.deepEqual(calls.selected, []);
  assert.equal(calls.restoreDone, 0);
  await mounted.unmount();
});

test("startup still restores an explicit URL session and aligns its directory", async () => {
  const { calls, props } = baseProps({ initialSessionId: "s2" });
  const mounted = await mountSidebar(props);
  await settle();

  assert.equal(calls.selected.length, 1);
  assert.equal(calls.selected[0].id, "s2");
  assert.ok(calls.cwdChanges.includes("/proj-b"));
  assert.equal(calls.restoreDone, 0);
  await mounted.unmount();
});

test("a missing explicit session reports not-found without choosing any space", async () => {
  const { calls, props } = baseProps({ initialSessionId: "missing" });
  const mounted = await mountSidebar(props);
  await settle();

  assert.deepEqual(calls.selected, []);
  assert.deepEqual(calls.cwdChanges, []);
  assert.equal(calls.restoreDone, 1);
  await mounted.unmount();
});
