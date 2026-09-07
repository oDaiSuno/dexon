import { importTestBundle } from "#test-bundle";
import { createDeferred } from "#test-timing";
import assert from "node:assert/strict";
import path from "node:path";
import test, { after } from "node:test";
import { dom, restoreGlobals } from "../session-sidebar/session-sidebar-pickers-dom-setup.mjs";
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";

// Composite regression test for the Phase 6 space echo chain: the real
// AppShell, space coordinator, workspace navigation and SessionSidebar are
// mounted together while the coordinator's startup restore and a desktop
// deep link resolve in the same batch. The stale push-down echoes must be
// recognized as coordinator echoes — they must never close the freshly
// restored session, commit oscillating spaces, or write the preference in a
// loop.

const projectRoot = path.resolve(import.meta.dirname, "../../../..");

const { AppShell } = await importTestBundle("app-shell-space-echo", {
  stdin: {
    contents: 'export { AppShell } from "./src/renderer/components/AppShell.tsx";',
    resolveDir: projectRoot,
    sourcefile: "app-shell-space-echo-test-entry.tsx",
    loader: "tsx",
  },
  tsconfig: path.join(projectRoot, "tsconfig.renderer.json"),
  external: ["react", "react-dom", "react-dom/*"],
  plugins: [
    {
      name: "app-shell-space-echo-stubs",
      setup(build) {
        build.onResolve({ filter: /(^|\/)api-client$/ }, () => ({ path: "api", namespace: "shell-echo" }));
        build.onResolve({ filter: /(^|\/)router-compat$/ }, () => ({ path: "router", namespace: "shell-echo" }));
        build.onResolve({ filter: /\.png$/ }, () => ({ path: "png", namespace: "shell-echo" }));
        build.onResolve({ filter: /(^|\/)ChatWindow$/ }, () => ({ path: "chat-window", namespace: "shell-echo" }));
        build.onResolve({ filter: /(^|\/)SettingsConfig$/ }, () => ({ path: "settings", namespace: "shell-echo" }));
        build.onResolve({ filter: /BrowserAuthorizationDialog$/ }, () => ({
          path: "auth-dialog",
          namespace: "shell-echo",
        }));
        build.onResolve({ filter: /(^|\/)app-shell\/top-bar$/ }, () => ({ path: "top-bar", namespace: "shell-echo" }));
        build.onResolve({ filter: /(^|\/)app-shell\/right-panel-dock$/ }, () => ({
          path: "right-dock",
          namespace: "shell-echo",
        }));
        build.onResolve({ filter: /(^|\/)useIsMobile$/ }, () => ({ path: "is-mobile", namespace: "shell-echo" }));
        build.onResolve({ filter: /(^|\/)SessionProfiler$/ }, () => ({
          path: "session-profiler",
          namespace: "shell-echo",
        }));
        build.onLoad({ filter: /.*/, namespace: "shell-echo" }, ({ path: modulePath }) => {
          if (modulePath === "png") {
            return { contents: 'export default "data:image/png;base64,";', loader: "js" };
          }
          if (modulePath === "router") {
            return {
              contents:
                "export const routerCompat = {\n" +
                "  replace: (...args) => globalThis.__shellHarness.routerCalls.push(args),\n" +
                "};\n" +
                "export function readSessionIdFromSearch(search) {\n" +
                '  return new URLSearchParams(search).get("session");\n' +
                "}",
              loader: "js",
            };
          }
          if (modulePath === "api") {
            return {
              contents:
                "export const listSessions = async () => globalThis.__shellHarness.listSessions();\n" +
                "export const subscribeSessionsChanged = async () => () => undefined;\n" +
                "export const subscribe = async () => () => undefined;\n" +
                "export const call = async (method, params) => {\n" +
                "  const harness = globalThis.__shellHarness;\n" +
                "  if (method === 'worktrees.list') {\n" +
                "    return { projectRoot: params?.projectRoot ?? '', isGit: false, isTopLevel: false, worktrees: [] };\n" +
                "  }\n" +
                "  if (method === 'system.validateCwd') return harness.validateCwd(params?.path ?? '');\n" +
                "  if (method === 'system.defaultCwd') return harness.defaultCwd();\n" +
                "  return {};\n" +
                "};\n" +
                "export const validateCwd = async (path) => globalThis.__shellHarness.validateCwd(path);\n" +
                "export const defaultCwd = async () => globalThis.__shellHarness.defaultCwd();",
              loader: "js",
            };
          }
          if (modulePath === "chat-window") {
            return {
              contents:
                "export function ChatWindow(props) {\n" +
                "  globalThis.__shellHarness.chat.push(props.session?.id ?? null);\n" +
                "  return null;\n" +
                "}",
              loader: "js",
            };
          }
          if (modulePath === "settings") {
            return { contents: "export const SettingsConfig = () => null;", loader: "js" };
          }
          if (modulePath === "auth-dialog") {
            return { contents: "export const BrowserAuthorizationDialog = () => null;", loader: "js" };
          }
          if (modulePath === "top-bar") {
            return { contents: "export const TopBar = () => null;", loader: "js" };
          }
          if (modulePath === "is-mobile") {
            return { contents: "export const useIsMobile = () => false;", loader: "js" };
          }
          if (modulePath === "session-profiler") {
            return {
              contents: "export const SessionProfiler = ({ children }) => children;",
              loader: "js",
            };
          }
          return {
            contents:
              "export const EXPLORER_TAB_ID = 'explorer';\n" +
              "export function useRightPanelDock() {\n" +
              "  return {\n" +
              "    activeFileTabId: null,\n" +
              "    fileTabs: [],\n" +
              "    dispatchFileTab: () => {},\n" +
              "    rightPanelOpen: false,\n" +
              "    rightPanelWidth: 0,\n" +
              "    rightPanelBounds: null,\n" +
              "    rightPanelResizing: false,\n" +
              "    managedProcessCount: 0,\n" +
              "    managedProcessAttention: false,\n" +
              "    setManagedProcessCount: () => {},\n" +
              "    handleRightPanelToggle: () => {},\n" +
              "    handleRightPanelResizeStart: () => {},\n" +
              "    handleRightPanelResizeKeyDown: () => {},\n" +
              "    openRightPanel: () => {},\n" +
              "  };\n" +
              "}\n" +
              "export const RightPanelDock = () => null;",
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

let originalFetch = null;
let originalEventSource = null;

function installNetwork() {
  originalFetch = globalThis.fetch;
  originalEventSource = globalThis.EventSource;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.startsWith("/api/sessions")) {
      return { ok: true, json: async () => ({ sessions: [], runningSessionIds: [] }) };
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
}

function restoreNetwork() {
  globalThis.fetch = originalFetch;
  if (originalEventSource === undefined) delete globalThis.EventSource;
  else globalThis.EventSource = originalEventSource;
}

installNetwork();
after(() => {
  restoreNetwork();
  restoreGlobals();
});

async function settle(rounds = 8) {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function mountShell() {
  const harness = {
    chat: [],
    routerCalls: [],
    preferenceWrites: [],
    deepLinkHandler: null,
    listSessionsGate: createDeferred(),
    validateGate: createDeferred(),
  };
  globalThis.__shellHarness = harness;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.piBridge = {
    getUiState: async () => ({ lastSpaceCwd: "/A" }),
    setUiState: async (patch) => {
      harness.preferenceWrites.push(patch);
    },
    openDirectory: async () => {},
    onMenu: () => () => undefined,
    onDeepLinkSession: (handler) => {
      harness.deepLinkHandler = handler;
      return () => undefined;
    },
    onHostRestarted: () => () => undefined,
    onBrowserEvent: () => () => undefined,
  };
  globalThis.__shellHarness = {
    ...harness,
    validateCwd: async (path) => {
      await harness.validateGate.promise;
      return { ok: true, path };
    },
    defaultCwd: async () => {
      throw new Error("defaultCwd must not run when a stored space exists");
    },
    listSessions: async () => {
      await harness.listSessionsGate.promise;
      return { sessions: [session("sB", "/B", "2026-09-05T10:00:00.000Z")] };
    },
  };

  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(AppShell, {
        chatAppearance: {},
        chatAppearanceSaving: false,
        onChatAppearanceChange: async () => {},
      }),
    );
  });
  return {
    harness,
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      container.remove();
      delete globalThis.__shellHarness;
      delete dom.window.piBridge;
      delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    },
  };
}

test("a deep link resolving alongside the startup restore wins without echo oscillation", async () => {
  const mounted = await mountShell();
  const { harness } = mounted;
  await settle();

  // The startup restore is in flight (validate gate pending); fire the deep link.
  assert.equal(typeof harness.deepLinkHandler, "function");
  await act(async () => {
    harness.deepLinkHandler("sB");
  });
  await settle();

  // Release both async results inside the same batch: the stored-space
  // validation and the deep link's session lookup interleave their
  // continuations exactly like the reported race.
  await act(async () => {
    harness.validateGate.resolve();
    harness.listSessionsGate.resolve();
  });

  // Bounded flushing: an echo loop would keep mutating state forever.
  await settle(30);

  const lastSession = harness.chat[harness.chat.length - 1];
  assert.equal(lastSession, "sB", "the deep-linked session must stay open");
  assert.ok(harness.chat.includes("sB"), "the deep-linked session must have rendered");

  // The remembered space settles on the session's directory, not the stale
  // restore target, and the preference writes stay bounded (no /A /B loop).
  const lastWrite = harness.preferenceWrites[harness.preferenceWrites.length - 1];
  assert.deepEqual(lastWrite, { lastSpaceCwd: "/B" });
  const lastBIndex = harness.preferenceWrites.map((patch) => patch.lastSpaceCwd).lastIndexOf("/B");
  const afterB = harness.preferenceWrites.slice(lastBIndex + 1).map((patch) => patch.lastSpaceCwd);
  assert.deepEqual(afterB, [], "no write may follow the final /B commit");

  // The router must not oscillate between the session URL and "/".
  const lastRoute = harness.routerCalls[harness.routerCalls.length - 1]?.[0];
  assert.equal(lastRoute, "?session=sB");
  assert.ok(harness.routerCalls.length <= 4, `router churn detected: ${JSON.stringify(harness.routerCalls)}`);

  // Stability: further flushing changes nothing.
  const chatLength = harness.chat.length;
  const writesLength = harness.preferenceWrites.length;
  await settle(10);
  assert.deepEqual(harness.preferenceWrites.slice(writesLength), []);
  assert.equal(harness.chat.length, chatLength);
  await mounted.unmount();
});
