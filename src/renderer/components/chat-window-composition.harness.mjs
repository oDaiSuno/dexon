import { JSDOM } from "jsdom";
import { importTestBundle } from "#test-bundle";
import path from "node:path";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { createSessionDetail, createSessionTestHost } from "../hooks/agent-session/session-hook-harness.mjs";

/**
 * Shared harness for the retained ChatWindow composition test (ASTRA-R5-G001.2).
 *
 * Mounts the ACTUAL ChatWindow component (real useChatWindow, useAgentSession,
 * ChatInput, ChatMinimap, sentinel and viewport owners) in jsdom with mocked
 * external IO and explicit observer/listener/frame/timer registries. The
 * reading-side owners are the same ones ChatWindow wires together: presence
 * ResizeObserver, viewport-height ResizeObserver, minimap ResizeObserver,
 * history sentinel IntersectionObserver, window/container listeners, rAF
 * frames and the 30ms/50ms presence/minimap timers.
 */

const ROOT = path.resolve(import.meta.dirname, "../../..");

const API_NAMES = [
  "agentCommand",
  "agentState",
  "call",
  "cancelModelsRefresh",
  "getSession",
  "getSessionContext",
  "getSessionContextPage",
  "getSessionEntryContent",
  "listModels",
  "newAgent",
  "readFile",
  "refreshModels",
  "subscribeAgentEvents",
  "subscribeSessionsChanged",
];

class FakeResizeObserver {
  constructor(callback) {
    this.callback = callback;
    this.observed = [];
    this.disconnectCount = 0;
    FakeResizeObserver.instances.push(this);
  }
  observe(target) {
    this.observed.push(target);
  }
  unobserve() {}
  disconnect() {
    this.disconnectCount += 1;
  }
  emit() {
    this.callback();
  }
}

class FakeIntersectionObserver {
  constructor(callback) {
    this.callback = callback;
    this.observed = [];
    this.disconnectCount = 0;
    FakeIntersectionObserver.instances.push(this);
  }
  observe(target) {
    this.observed.push(target);
  }
  unobserve() {}
  disconnect() {
    this.disconnectCount += 1;
  }
  emit(entry) {
    this.callback([entry]);
  }
}

/**
 * Installs jsdom globals with registries and returns the environment handle.
 * The true pre-test descriptors are captured and restored exactly on restore().
 */
export function installCompositionEnvironment() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });
  const names = [
    "window",
    "document",
    "HTMLElement",
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

  const resizeObservers = [];
  const intersectionObservers = [];
  const rafQueue = new Map();
  const windowListeners = new Map();
  const documentListeners = new Map();
  const elementListeners = new Map();
  const scrollIntoViewCalls = [];
  const scrollToCalls = [];
  const storedValues = new Map();
  let rafSeq = 0;

  FakeResizeObserver.instances = resizeObservers;
  FakeIntersectionObserver.instances = intersectionObservers;

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
    Node: { configurable: true, value: dom.window.Node },
    navigator: { configurable: true, value: dom.window.navigator },
    ResizeObserver: { configurable: true, value: FakeResizeObserver },
    IntersectionObserver: { configurable: true, value: FakeIntersectionObserver },
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
  dom.window.HTMLElement.prototype.attachEvent = () => {};
  dom.window.HTMLElement.prototype.detachEvent = () => {};
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

  return {
    dom,
    root: dom.window.document.getElementById("root"),
    resizeObservers,
    intersectionObservers,
    rafQueue,
    windowListeners,
    documentListeners,
    elementListeners,
    scrollIntoViewCalls,
    scrollToCalls,
    storedValues,
    activeResizeObservers() {
      return resizeObservers.filter((observer) => observer.disconnectCount === 0);
    },
    activeIntersectionObservers() {
      return intersectionObservers.filter((observer) => observer.disconnectCount === 0);
    },
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
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
      dom.window.close();
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
 * Bundles the real ChatWindow with the session RPC layer, i18n and syntax
 * highlighting replaced by harness delegates. Auto-title runs the real module
 * over the RPC delegate. The i18n `t` is a module-level constant: an unstable
 * `t` identity would re-run the model-load effect on every render and loop
 * forever.
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
    const delegate = (module, names) =>
      names
        .map(
          (name) =>
            `export function ${name}(...args) { const host = globalThis.${globalName}; const fn = host?.${name}; ` +
            `if (typeof fn !== "function") throw new Error("${module}.${name} is not configured in the harness host"); ` +
            `return fn(...args); }`,
        )
        .join("\n");

    const { ChatWindow } = await importTestBundle("chat-window-composition", {
      packages: "external",
      tsconfig: path.resolve(ROOT, "tsconfig.renderer.json"),
      stdin: {
        contents: 'export { ChatWindow } from "./src/renderer/components/ChatWindow.tsx";',
        resolveDir: ROOT,
        sourcefile: "chat-window-composition-entry.tsx",
        loader: "tsx",
      },
      loader: { ".png": "dataurl" },
      define: { "import.meta.env.DEV": "false" },
      plugins: [
        {
          name: "composition-stubs",
          setup(build) {
            build.onResolve({ filter: /(^|\/)api-client$/ }, () => ({ path: "api", namespace: "stub" }));
            build.onResolve({ filter: /(^|\/)agent-client$/ }, () => ({ path: "agent", namespace: "stub" }));
            build.onResolve({ filter: /^@\/i18n$/ }, () => ({ path: "i18n", namespace: "stub" }));
            build.onResolve({ filter: /^@\/lib\/syntax-highlight$/ }, () => ({ path: "syntax", namespace: "stub" }));
            build.onLoad({ filter: /.*/, namespace: "stub" }, ({ path: p }) => ({
              contents:
                p === "i18n"
                  ? 'const t = (k, fb) => fb; export const useI18n = () => ({ t, language: "en" });'
                  : p === "syntax"
                    ? 'export const SyntaxHighlighter = (props) => String(props.children ?? ""); export const vs = {}; export const vscDarkPlus = {}; export const preloadSyntaxHighlighter = async () => {};'
                    : p === "agent"
                      ? delegate("agent-client", ["sendAgentCommand"])
                      : delegate("api-client", API_NAMES),
              loader: "js",
            }));
          },
        },
      ],
    });
    return { ChatWindow, releaseHost };
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
      await act(async () => root.unmount());
      env.root.textContent = "";
    },
  };
}

/** Flush microtasks and one macrotask so async RPC continuations settle. */
export async function flushAsync() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}
