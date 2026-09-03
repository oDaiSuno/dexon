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

const originals = {
  cancelAnimationFrame: globalThis.cancelAnimationFrame,
  document: globalThis.document,
  fetch: globalThis.fetch,
  HTMLElement: globalThis.HTMLElement,
  navigator: globalThis.navigator,
  Node: globalThis.Node,
  requestAnimationFrame: globalThis.requestAnimationFrame,
  window: globalThis.window,
};

const storedValues = new Map();

Object.defineProperties(globalThis, {
  cancelAnimationFrame: { configurable: true, value: () => {} },
  document: { configurable: true, value: dom.window.document },
  HTMLElement: { configurable: true, value: dom.window.HTMLElement },
  navigator: { configurable: true, value: dom.window.navigator },
  Node: { configurable: true, value: dom.window.Node },
  requestAnimationFrame: {
    configurable: true,
    value(callback) {
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
  for (const [key, value] of Object.entries(originals)) {
    if (value === undefined) delete globalThis[key];
    else Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
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
};
