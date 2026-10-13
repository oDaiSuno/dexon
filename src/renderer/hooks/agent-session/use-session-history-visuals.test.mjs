import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import path from "node:path";
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import test from "node:test";
import {
  createReadingSurface,
  createSessionDetail,
  createSessionHookHarness,
  createSessionTestHost,
} from "./session-hook-harness.mjs";

const { useSessionHistoryVisuals } = await importTestBundle("use-session-history-visuals-regression", {
  stdin: {
    contents: 'export { useSessionHistoryVisuals } from "./use-session-history-visuals.ts";',
    resolveDir: import.meta.dirname,
    sourcefile: "use-session-history-visuals-regression-entry.ts",
    loader: "ts",
  },
  tsconfig: path.join(import.meta.dirname, "../../../../tsconfig.renderer.json"),
  external: ["react", "react-dom", "react-dom/*"],
});

function installDom() {
  const dom = new JSDOM('<!doctype html><body><div id="root"></div>');
  const names = [
    "window",
    "document",
    "HTMLElement",
    "Node",
    "navigator",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "IS_REACT_ACT_ENVIRONMENT",
  ];
  const originals = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of ["window", "document", "HTMLElement", "Node", "navigator"]) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: name === "window" ? dom.window : name === "document" ? dom.window.document : dom.window[name],
    });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
    writable: true,
  });
  return {
    dom,
    root: dom.window.document.getElementById("root"),
    restore() {
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
      dom.window.close();
    },
  };
}

function installFrames() {
  const frames = new Map();
  let nextId = 0;
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    value: (callback) => {
      const id = ++nextId;
      frames.set(id, callback);
      return id;
    },
  });
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    configurable: true,
    value: (id) => frames.delete(id),
  });
  return frames;
}

function visualProps(element) {
  return {
    historyGenerationRef: { current: 1 },
    historyRevisionRef: { current: "revision" },
    sessionIdRef: { current: "session" },
    scrollContainerRef: { current: element },
  };
}

test("history visual scheduling survives StrictMode effect replay", async (t) => {
  const environment = installDom();
  const frames = installFrames();
  let renderer;
  let handle;
  const element = {
    scrollTop: 100,
    scrollHeight: 700,
    getBoundingClientRect: () => ({ top: 0, bottom: 600 }),
  };
  function Probe() {
    handle = useSessionHistoryVisuals({ ...visualProps(element), readingVisible: true });
    return null;
  }
  t.after(async () => {
    if (renderer) await act(async () => renderer.unmount());
    environment.restore();
  });

  renderer = createRoot(environment.root);
  await act(async () => renderer.render(createElement(StrictMode, null, createElement(Probe))));
  handle.queueHistoryAnchor({
    element,
    previousScrollHeight: 400,
    previousScrollTop: 100,
    contentAnchor: null,
    generation: 1,
    sessionId: "session",
    revision: "revision",
  });
  assert.equal(frames.size, 1, "a StrictMode-replayed hook must still schedule a valid frame");
  for (const callback of frames.values()) callback();
  frames.clear();
  assert.equal(element.scrollTop, 400, "the valid post-replay anchor must be restored");
});

test("history pagination passes a stable content anchor to visual restoration", async (t) => {
  const surface = createReadingSurface({ scrollTop: 100, scrollHeight: 400, clientHeight: 200 });
  let anchorTop = 100;
  const messageRefs = {
    current: [
      {
        isConnected: true,
        getBoundingClientRect: () => ({ top: anchorTop, bottom: anchorTop + 40 }),
      },
    ],
  };
  const detail = createSessionDetail("history-anchor", { previousCursor: "older", historyRevision: "revision" });
  let resolvePage;
  const host = createSessionTestHost({
    getSession: async () => detail,
    getSessionContextPage: () => new Promise((resolve) => (resolvePage = resolve)),
  });
  const h = await createSessionHookHarness(t, {
    bundleName: "history-content-anchor",
    host,
    attach(state) {
      state.scrollContainerRef.current = surface.container;
      state.liveContentEndRef.current = surface.liveEnd;
      state.messagesEndRef.current = surface.messagesEnd;
    },
  });
  const options = { session: detail.info, newSessionCwd: null, messageRefs };
  await h.mount({ ...options, readingVisible: true });
  await h.flush();
  await h.env.flushRafUntilSettled();
  const loadPromise = h.state.loadOlder();
  await h.flush();
  await h.update({ ...options, readingVisible: false });
  resolvePage({
    context: {
      messages: [{ role: "user", content: "older", timestamp: 0 }],
      entryIds: ["older"],
      historyRevision: "revision",
      previousCursor: null,
    },
  });
  await loadPromise;
  await h.flush();
  surface.container.scrollHeight = 900;
  anchorTop = 400;
  await h.update({ ...options, readingVisible: true });
  await h.flush();
  assert.equal(h.env.rafSize(), 1, "show queues the deferred anchor reconciliation");
  await h.env.flushRafUntilSettled();
  assert.equal(surface.container.scrollTop, 400, "unrelated hidden tail growth does not move the reading anchor");
});

test("history restoration attributes hidden growth to the stable content anchor", async (t) => {
  const environment = installDom();
  const frames = installFrames();
  let renderer;
  let handle;
  let anchorTop = 100;
  const contentAnchor = {
    isConnected: true,
    getBoundingClientRect: () => ({ top: anchorTop, bottom: anchorTop + 40 }),
  };
  const element = {
    scrollTop: 100,
    scrollHeight: 400,
    getBoundingClientRect: () => ({ top: 0, bottom: 600 }),
  };
  const props = visualProps(element);
  function Probe({ visible }) {
    handle = useSessionHistoryVisuals({ ...props, readingVisible: visible });
    return null;
  }
  t.after(async () => {
    if (renderer) await act(async () => renderer.unmount());
    environment.restore();
  });

  renderer = createRoot(environment.root);
  await act(async () => renderer.render(createElement(Probe, { visible: true })));
  await act(async () => renderer.render(createElement(Probe, { visible: false })));
  element.scrollHeight = 900;
  anchorTop = 400;
  handle.queueHistoryAnchor({
    element,
    previousScrollHeight: 400,
    previousScrollTop: 100,
    contentAnchor: { element: contentAnchor, offsetTop: 100 },
    generation: 1,
    sessionId: "session",
    revision: "revision",
  });
  assert.equal(frames.size, 0, "hidden history completion must not queue a visual frame");

  await act(async () => renderer.render(createElement(Probe, { visible: true })));
  assert.equal(frames.size, 1, "show must queue one deferred anchor reconciliation");
  for (const callback of frames.values()) callback();
  frames.clear();
  assert.equal(element.scrollTop, 400, "tail growth must not be mistaken for prepended history");
});
