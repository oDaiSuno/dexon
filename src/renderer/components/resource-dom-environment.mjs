import { JSDOM } from "jsdom";

/**
 * DOM environment for the Phase 3 resource/settings component tests. The
 * module must be imported (and therefore evaluated) BEFORE react and
 * react-dom so their module-level feature detection sees a realistic
 * browser environment; without a window at react-dom evaluation time the
 * change-event plugin permanently falls back to its IE-era polyfill, which
 * crashes on jsdom's missing attachEvent during focus handling.
 *
 * Lifecycle contract:
 *  - the environment installs itself at module evaluation;
 *  - `restoreGlobals()` puts every injected global back to its exact pre-import
 *    state, deleting globals that did not exist before (window, document,
 *    HTMLElement, Node) and restoring original property descriptors — including
 *    `IS_REACT_ACT_ENVIRONMENT` — for globals that did exist;
 *  - `installDomEnvironment()` re-installs after a restore so a test file
 *    can toggle the environment without re-importing the module;
 *  - `createManagedDomRoot()` owns one React DOM root per test case with an
 *    awaitable, idempotent unmount that always removes its container.
 */

export const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: "http://localhost/",
});

export const rootContainer = () => dom.window.document.querySelector("#root");

// jsdom lacks TextEvent; restoring it mirrors real browsers and keeps React on
// the modern input-event path.
dom.window.TextEvent = dom.window.Event;

// Synchronous rAF keeps transition-driven rendering deterministic inside act().
dom.window.requestAnimationFrame = (callback) => {
  callback(0);
  return 1;
};
dom.window.cancelAnimationFrame = () => {};

const originals = {
  window: Object.getOwnPropertyDescriptor(globalThis, "window"),
  document: Object.getOwnPropertyDescriptor(globalThis, "document"),
  HTMLElement: Object.getOwnPropertyDescriptor(globalThis, "HTMLElement"),
  navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
  Node: Object.getOwnPropertyDescriptor(globalThis, "Node"),
  IS_REACT_ACT_ENVIRONMENT: Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT"),
};

const INJECTED_GLOBALS = ["window", "document", "HTMLElement", "navigator", "Node", "IS_REACT_ACT_ENVIRONMENT"];

export function installDomEnvironment() {
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    navigator: { configurable: true, value: dom.window.navigator },
    Node: { configurable: true, value: dom.window.Node },
  });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
}

installDomEnvironment();

export function restoreGlobals() {
  for (const name of INJECTED_GLOBALS) {
    const descriptor = originals[name];
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
}

let activeTracker = null;

/**
 * Records beforeunload subscriptions on the jsdom window so tests can pin
 * the dirty-editor window guard without disturbing real dispatching.
 * The wrap is installed at most once; a previous tracker's `restore()`
 * detaches it, after which it observes nothing. Creating a new tracker
 * after a restore installs a fresh, independent wrap.
 */
export function trackBeforeUnloadListeners() {
  if (activeTracker) return activeTracker;
  const listeners = new Set();
  const savedAdd = Object.getOwnPropertyDescriptor(dom.window, "addEventListener");
  const savedRemove = Object.getOwnPropertyDescriptor(dom.window, "removeEventListener");
  const nativeAdd = dom.window.addEventListener.bind(dom.window);
  const nativeRemove = dom.window.removeEventListener.bind(dom.window);
  dom.window.addEventListener = (type, handler, options) => {
    if (type === "beforeunload") listeners.add(handler);
    return nativeAdd(type, handler, options);
  };
  dom.window.removeEventListener = (type, handler, options) => {
    if (type === "beforeunload") listeners.delete(handler);
    return nativeRemove(type, handler, options);
  };
  const tracker = {
    listeners,
    restore() {
      if (activeTracker !== tracker) return; // already disposed; a later tracker owns the wraps
      listeners.clear();
      for (const [method, descriptor] of [
        ["addEventListener", savedAdd],
        ["removeEventListener", savedRemove],
      ]) {
        if (descriptor) Object.defineProperty(dom.window, method, descriptor);
        else delete dom.window[method];
      }
      activeTracker = null;
    },
  };
  activeTracker = tracker;
  return tracker;
}

/**
 * Owns one React DOM root for a test case. `render` mounts into a fresh
 * container under the jsdom body; `unmount` is awaitable, idempotent, and
 * always removes the container — even when an assertion failure skipped the
 * happy-path cleanup. The react import is dynamic so this fixture still
 * evaluates before react at module-load time.
 */
export function createManagedDomRoot() {
  let root = null;
  let container = null;
  return {
    get container() {
      return container;
    },
    async render(element) {
      if (root) throw new Error("managed root already rendered; unmount it first");
      const { act } = await import("react");
      const { createRoot } = await import("react-dom/client");
      container = dom.window.document.createElement("div");
      dom.window.document.body.appendChild(container);
      root = createRoot(container);
      await act(async () => {
        root.render(element);
      });
    },
    async unmount() {
      if (!root) return;
      const activeRoot = root;
      const activeContainer = container;
      root = null;
      container = null;
      const { act } = await import("react");
      try {
        await act(async () => {
          activeRoot.unmount();
        });
      } finally {
        activeContainer.remove();
      }
      return { removed: !activeContainer.isConnected };
    },
  };
}
