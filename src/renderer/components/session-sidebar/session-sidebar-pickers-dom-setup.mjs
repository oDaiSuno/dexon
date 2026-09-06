import { JSDOM } from "jsdom";

/**
 * DOM environment for the sidebar pickers tests. Imported (and therefore
 * evaluated) BEFORE react-dom so React's module-level feature detection sees a
 * realistic browser environment: without a window at react-dom evaluation time
 * the change-event plugin permanently falls back to its IE-era polyfill, which
 * crashes on jsdom's missing attachEvent during focus handling and derails the
 * node test runner.
 */

export const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: "http://localhost/",
});

export const rootContainer = () => dom.window.document.querySelector("#root");

// jsdom lacks TextEvent; restoring it mirrors real browsers and keeps React on
// the modern input-event path.
dom.window.TextEvent = dom.window.Event;

// Synchronous rAF keeps the AnimatedDropdown open/close transitions
// deterministic inside act().
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

Object.defineProperties(globalThis, {
  window: { configurable: true, value: dom.window },
  document: { configurable: true, value: dom.window.document },
  HTMLElement: { configurable: true, value: dom.window.HTMLElement },
  navigator: { configurable: true, value: dom.window.navigator },
  Node: { configurable: true, value: dom.window.Node },
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

export function restoreGlobals() {
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  for (const [name, descriptor] of Object.entries(originals)) {
    if (!descriptor) continue;
    Object.defineProperty(globalThis, name, descriptor);
  }
}
