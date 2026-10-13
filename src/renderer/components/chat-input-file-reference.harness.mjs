import { JSDOM } from "jsdom";

/**
 * Shared jsdom harness for the composer tests. The composer is a
 * contenteditable surface, so driving it needs a real DOM with
 * Range/Selection support. Import this module BEFORE loading any app bundle:
 * the global environment is prepared at module-evaluation time.
 */

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: "http://localhost/",
  pretendToBeVisual: true,
});

// React's legacy input-event fallback probes these IE-era methods when an
// auto-focused nested input is mounted. Keep the DOM harness quiet without
// changing production behavior.
dom.window.HTMLElement.prototype.attachEvent = () => {};
dom.window.HTMLElement.prototype.detachEvent = () => {};

// Complete entry descriptors of every global this harness borrows, captured
// before the first mutation so accessors, property flags and absence are
// restored exactly (ASTRA-R10-F001).
const BORROWED_GLOBALS = [
  "cancelAnimationFrame",
  "document",
  "fetch",
  "HTMLElement",
  "navigator",
  "Node",
  "requestAnimationFrame",
  "window",
  "localStorage",
  "IS_REACT_ACT_ENVIRONMENT",
];
const originals = new Map(BORROWED_GLOBALS.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));

const storedValues = new Map();

Object.defineProperties(globalThis, {
  cancelAnimationFrame: { configurable: true, value: (id) => pendingFrames.delete(id) },
  document: { configurable: true, value: dom.window.document },
  HTMLElement: { configurable: true, value: dom.window.HTMLElement },
  navigator: { configurable: true, value: dom.window.navigator },
  Node: { configurable: true, value: dom.window.Node },
  requestAnimationFrame: {
    configurable: true,
    value(callback) {
      if (rafQueueMode) {
        const id = (rafSeq += 1);
        pendingFrames.set(id, callback);
        return id;
      }
      callback(0);
      return 1;
    },
  },
  window: { configurable: true, value: dom.window },
});
// localStorage is backed by the same store map drafts use in tests.
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem(key) {
      return storedValues.get(key) ?? null;
    },
    setItem(key, value) {
      storedValues.set(key, String(value));
    },
    removeItem(key) {
      storedValues.delete(key);
    },
  },
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// jsdom does not implement scrolling (menu rows call scrollIntoView in effects).
dom.window.HTMLElement.prototype.scrollIntoView = () => {};

const fetchRequests = [];
const showItemInFolderCalls = [];
const defaultFetchImplementation = async () => ({
  ok: true,
  async json() {
    return { files: ["src/main.ts", "src/renderer/App.tsx", "README.md"], truncated: false };
  },
});
let fetchImplementation = defaultFetchImplementation;
let stageClipboardImageImplementation = async () => ({
  ok: false,
  code: "stage-unavailable",
  message: "not mocked",
});

// rAF is synchronous by default (existing tests rely on immediate frames).
// Tests that need to prove queued-frame cancellation opt into queue mode,
// where requestAnimationFrame stores callbacks until flushRaf() runs them and
// cancelAnimationFrame removes them.
let rafQueueMode = false;
const pendingFrames = new Map();
let rafSeq = 0;

globalThis.fetch = async (url, options) => {
  fetchRequests.push(String(url));
  return fetchImplementation(url, options);
};

dom.window.piBridge = {
  getPathForFile(file) {
    return file.testPath ?? null;
  },
  stageClipboardImage(request) {
    return stageClipboardImageImplementation(request);
  },
  async inspectLocalFiles({ paths }) {
    return paths.map((filePath) => ({ path: filePath, exists: true, isFile: true, insideCwd: false }));
  },
  showItemInFolder(fsPath) {
    showItemInFolderCalls.push(fsPath);
    return Promise.resolve();
  },
};

export const rootEl = dom.window.document.getElementById("root");

export function restoreGlobals() {
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
  dom.window.close();
}

export const harness = {
  dom,
  storedValues,
  fetchRequests,
  showItemInFolderCalls,
  defaultFetch: defaultFetchImplementation,
  setFetch(implementation) {
    fetchImplementation = implementation;
  },
  resetFetch() {
    fetchImplementation = defaultFetchImplementation;
  },
  setStageClipboardImage(implementation) {
    stageClipboardImageImplementation = implementation;
  },
  getStageClipboardImage() {
    return stageClipboardImageImplementation;
  },
  /** Give every test an isolated request history regardless of execution order. */
  resetRequests() {
    fetchRequests.length = 0;
    showItemInFolderCalls.length = 0;
  },
  /** Opt into queued rAF so tests can prove cancellation; off by default. */
  setRafQueue(enabled) {
    rafQueueMode = enabled;
    if (!enabled) pendingFrames.clear();
  },
  flushRaf() {
    const callbacks = [...pendingFrames.values()];
    pendingFrames.clear();
    for (const callback of callbacks) callback(0);
  },
  rafSize() {
    return pendingFrames.size;
  },
};
