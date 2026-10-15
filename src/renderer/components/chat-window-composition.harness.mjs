import { realRendererGraphOptions } from "./renderer-real-graph.mjs";
import { installApiHostBridge } from "../../../tests/support/api-host.mjs";
import { JSDOM } from "jsdom";
import { importTestBundle } from "#test-bundle";
import path from "node:path";
import { act, createElement } from "react";
import { createManualScheduler } from "#test-timing";
import { createBrowserObservers } from "../../../tests/support/browser-observers.mjs";
import { createSessionDetail, createSessionTestHost } from "../hooks/agent-session/session-hook-harness.mjs";

/**
 * Shared harness for the retained ChatWindow composition test (ASTRA-R5-G001.2).
 *
 * Mounts the ACTUAL ChatWindow component (real useChatWindow, useAgentSession,
 * ChatInput, ChatMinimap, sentinel and viewport owners) in jsdom with mocked
 * external IO. Browser signals are delivered by DOM target; the tests observe
 * public reading, history and drag behavior, not the number of internal owners.
 * Resource registries only account for released targets and leftover work.
 */

const ROOT = path.resolve(import.meta.dirname, "../../..");

/**
 * Installs jsdom globals with registries and returns the environment handle.
 * The true pre-test descriptors are captured and restored exactly on restore().
 */
export function installCompositionEnvironment() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });
  // Initialize the browser's selector/focus machinery before accounting for
  // the page's listeners. JSDOM's own mouse/key listeners are not scene work.
  const root = dom.window.document.querySelector("#root");
  const names = [
    "window",
    "document",
    "HTMLElement",
    "Element",
    "Event",
    "KeyboardEvent",
    "WheelEvent",
    "TouchEvent",
    "Node",
    "navigator",
    "fetch",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "ResizeObserver",
    "IntersectionObserver",
    "localStorage",
    "IS_REACT_ACT_ENVIRONMENT",
  ];
  const originals = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));

  const observers = createBrowserObservers();
  const clock = createManualScheduler();
  const rafQueue = new Map();
  const windowListeners = new Map();
  const documentListeners = new Map();
  const elementListeners = new Map();
  const scrollIntoViewCalls = [];
  const scrollToCalls = [];
  const storedValues = new Map();
  let rafSeq = 0;

  const recordListener = (map) => (type, fn) => {
    const list = map.get(type) ?? [];
    list.push(fn);
    map.set(type, list);
  };
  const unrecordListener = (map) => (type, fn) => {
    const list = map.get(type) ?? [];
    const index = list.indexOf(fn);
    if (index >= 0) list.splice(index, 1);
  };

  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    ...Object.fromEntries(
      ["Element", "Event", "KeyboardEvent", "WheelEvent", "TouchEvent"].map((name) => [
        name,
        { configurable: true, value: dom.window[name] },
      ]),
    ),
    Node: { configurable: true, value: dom.window.Node },
    navigator: { configurable: true, value: dom.window.navigator },
    ResizeObserver: { configurable: true, value: observers.ResizeObserver },
    IntersectionObserver: { configurable: true, value: observers.IntersectionObserver },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
    requestAnimationFrame: {
      configurable: true,
      value(callback) {
        const id = (rafSeq += 1);
        rafQueue.set(id, callback);
        return id;
      },
    },
    cancelAnimationFrame: { configurable: true, value: (id) => rafQueue.delete(id) },
    localStorage: {
      configurable: true,
      value: {
        getItem: (key) => storedValues.get(key) ?? null,
        setItem: (key, value) => storedValues.set(key, String(value)),
        removeItem: (key) => storedValues.delete(key),
      },
    },
  });

  dom.window.HTMLElement.prototype.scrollIntoView = function () {
    scrollIntoViewCalls.push(this);
  };
  dom.window.HTMLElement.prototype.scrollTo = function () {
    scrollToCalls.push(this);
  };
  dom.window.TextEvent = dom.window.Event;
  dom.window.setTimeout = clock.setTimeout;
  dom.window.clearTimeout = clock.clearTimeout;
  dom.window.setInterval = clock.setInterval;
  dom.window.clearInterval = clock.clearInterval;
  dom.window.requestAnimationFrame = globalThis.requestAnimationFrame;
  dom.window.cancelAnimationFrame = globalThis.cancelAnimationFrame;
  // Track native element listeners (reading-side wheel/touch/scroll) by element.
  const originalAdd = dom.window.HTMLElement.prototype.addEventListener;
  const originalRemove = dom.window.HTMLElement.prototype.removeEventListener;
  dom.window.HTMLElement.prototype.addEventListener = function (type, fn, options) {
    const byType = elementListeners.get(this) ?? new Map();
    const list = byType.get(type) ?? [];
    list.push(fn);
    byType.set(type, list);
    elementListeners.set(this, byType);
    return originalAdd.call(this, type, fn, options);
  };
  dom.window.HTMLElement.prototype.removeEventListener = function (type, fn, options) {
    const byType = elementListeners.get(this);
    if (byType) {
      const list = byType.get(type) ?? [];
      const index = list.indexOf(fn);
      if (index >= 0) list.splice(index, 1);
      byType.set(type, list);
    }
    return originalRemove.call(this, type, fn, options);
  };
  // Record window/document listeners into the registries.
  const recordWindow = recordListener(windowListeners);
  const unrecordWindow = unrecordListener(windowListeners);
  const recordDocument = recordListener(documentListeners);
  const unrecordDocument = unrecordListener(documentListeners);
  const originalWindowAdd = dom.window.addEventListener.bind(dom.window);
  const originalWindowRemove = dom.window.removeEventListener.bind(dom.window);
  const originalDocumentAdd = dom.window.document.addEventListener.bind(dom.window.document);
  const originalDocumentRemove = dom.window.document.removeEventListener.bind(dom.window.document);
  dom.window.addEventListener = (type, fn, options) => {
    recordWindow(type, fn);
    return originalWindowAdd(type, fn, options);
  };
  dom.window.removeEventListener = (type, fn, options) => {
    unrecordWindow(type, fn);
    return originalWindowRemove(type, fn, options);
  };
  dom.window.document.addEventListener = (type, fn, options) => {
    recordDocument(type, fn);
    return originalDocumentAdd(type, fn, options);
  };
  dom.window.document.removeEventListener = (type, fn, options) => {
    unrecordDocument(type, fn);
    return originalDocumentRemove(type, fn, options);
  };
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  dom.window.piBridge = {
    getPathForFile: (file) => file.testPath ?? null,
    stageClipboardImage: async () => ({ ok: false, code: "stage-unavailable", message: "not mocked" }),
    inspectLocalFiles: async ({ paths }) =>
      paths.map((p) => ({ path: p, exists: true, isFile: true, insideCwd: false })),
    showItemInFolder: async () => {},
    platform: "linux",
  };
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return { files: [], truncated: false };
    },
  });

  let restored = false;
  return {
    dom,
    root,
    clock,
    ...observers,
    rafQueue,
    windowListeners,
    documentListeners,
    elementListeners,
    scrollIntoViewCalls,
    scrollToCalls,
    storedValues,
    flushRaf() {
      const callbacks = [...rafQueue.values()];
      rafQueue.clear();
      for (const callback of callbacks) callback();
    },
    flushRafUntilSettled(maxPasses = 4) {
      for (let pass = 0; pass < maxPasses; pass += 1) {
        if (rafQueue.size === 0) return;
        this.flushRaf();
      }
      if (rafQueue.size !== 0) throw new Error("rAF queue did not settle");
    },
    restore() {
      if (restored) return;
      restored = true;
      dom.window.close();
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
    },
  };
}

/** Session host with every RPC the ChatWindow graph can call configured. */
export function createCompositionHost(overrides = {}) {
  const detail = createSessionDetail("composition");
  return createSessionTestHost({
    getSession: async () => overrides.getSession?.() ?? detail,
    getSessionContext: async () => overrides.getSessionContext?.() ?? detail.context,
    getSessionContextPage: async () => ({
      context: { messages: [], entryIds: [], historyRevision: "r", previousCursor: null },
      truncated: false,
    }),
    getSessionEntryContent: async () => ({ content: "" }),
    agentState: async () => ({ running: false, state: { isStreaming: false, isPromptRunning: false } }),
    listModels: async () => ({
      models: [],
      nameMap: {},
      thinkingLevels: {},
      thinkingLevelMaps: {},
      catalog: { source: "cache", refreshed: false, aborted: false, warnings: [] },
      defaultModel: null,
    }),
    newAgent: async () => overrides.newAgent?.() ?? detail,
    refreshModels: async () => ({
      models: [],
      nameMap: {},
      thinkingLevels: {},
      thinkingLevelMaps: {},
      catalog: { source: "cache", refreshed: false, aborted: false, warnings: [] },
      defaultModel: null,
    }),
    cancelModelsRefresh: async () => {},
    ...overrides,
  });
}

/**
 * Bundles ChatWindow and its real renderer dependencies. Session replies cross
 * a real message protocol; syntax highlighting and translation stay unchanged.
 */
export async function createChatWindowBundle(host, options = {}) {
  const globalName = "__compositionHost";
  // Own the exact prior binding so restore() is precise: an originally absent
  // slot must become absent again, and a pre-existing descriptor must return.
  const previousHostDescriptor = Object.getOwnPropertyDescriptor(globalThis, globalName);
  globalThis[globalName] = host;
  const releaseHost = () => {
    if (previousHostDescriptor) Object.defineProperty(globalThis, globalName, previousHostDescriptor);
    else delete globalThis[globalName];
  };
  try {
    // Test seam: simulate a fallible acquisition so the failure path (which
    // must release the host binding) is deterministically exercised.
    if (options.failAcquisition) throw new Error("simulated bundle acquisition failure");
    const { ChatWindow, resetRpc } = await importTestBundle("chat-window-composition", {
      packages: "external",
      tsconfig: path.resolve(ROOT, "tsconfig.renderer.json"),
      stdin: {
        contents:
          'export { ChatWindow } from "./src/renderer/components/ChatWindow.tsx"; export {resetRpc} from "./src/renderer/lib/api-client.ts";',
        resolveDir: ROOT,
        sourcefile: "chat-window-composition-entry.tsx",
        loader: "tsx",
      },
      loader: { ".png": "dataurl" },
      ...realRendererGraphOptions(ROOT, {
        define: {
          setTimeout: "window.setTimeout",
          clearTimeout: "window.clearTimeout",
          setInterval: "window.setInterval",
          clearInterval: "window.clearInterval",
        },
      }),
    });
    const boundary = installApiHostBridge(globalThis.window, () => host, resetRpc);
    let released = false;
    return {
      ChatWindow,
      async releaseHost() {
        if (released) return;
        released = true;
        // Closing a real client rejects pending requests. Drain their consumer
        // cleanup while the browser environment still exists, then release it.
        try {
          boundary.close();
          await flushAsync();
        } finally {
          releaseHost();
        }
      },
    };
  } catch (error) {
    releaseHost();
    throw error;
  }
}

/** Renders the real ChatWindow into the environment root and returns helpers. */
export function createCompositionHarness(env, ChatWindow) {
  let renderer = null;
  let currentProps = {};

  function elementFor(props) {
    currentProps = props;
    return createElement(ChatWindow, {
      session: props.session,
      newSessionCwd: props.newSessionCwd ?? null,
      visible: props.visible ?? true,
      thinkingExpansionStore: new Map(),
      processDetailsExpansionStore: new Map(),
      onOpenFile: props.onOpenFile,
    });
  }

  return {
    get renderer() {
      return renderer;
    },
    get props() {
      return currentProps;
    },
    async mount(props) {
      // Load React DOM only after the first real browser has been installed.
      const { createRoot } = await import("react-dom/client");
      renderer = createRoot(env.root);
      await act(async () => renderer.render(elementFor(props)));
    },
    async rerender(props) {
      await act(async () => renderer.render(elementFor({ ...currentProps, ...props })));
    },
    async unmount() {
      if (!renderer) return;
      const root = renderer;
      renderer = null;
      try {
        await act(async () => root.unmount());
      } finally {
        env.root.remove();
      }
    },
  };
}

/** Flush microtasks and one macrotask so async RPC continuations settle. */
export async function flushAsync() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}
