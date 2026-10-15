export { createSessionTestHost } from "../../../../tests/fixtures/session-host.mjs";
import { createBrowserObservers } from "../../../../tests/support/browser-observers.mjs";
import { realRendererGraphOptions } from "../../components/renderer-real-graph.mjs";
import { installApiHostBridge } from "../../../../tests/support/api-host.mjs";
import { releaseAll } from "../../../../tests/support/cleanup.mjs";
import { importTestBundle } from "#test-bundle";
import path from "node:path";
import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import {
  FakeElement,
  FakeKeyboardEvent,
  FakeTouchEvent,
  FakeWheelEvent,
  createReadingSurface,
  createSessionDetail,
  memoryStorage,
} from "./session-hook-fixtures.mjs";

export { createReadingSurface, createSessionDetail };

/**
 * Shared harness for exercising the real useAgentSession composition
 * (agent-session/* modules) against replies from an external Host fixture.
 *
 * Environment is assembled fresh per harness instance and fully restored in
 * t.after: no shared mutable state survives between tests, and every blocking
 * wait is driven by explicit deferreds, act() flushing, or t.mock.timers.
 */

const ROOT = path.resolve(import.meta.dirname, "../../../..");

/** Lease counter so multiple harnesses inside one test restore in the right order. */
let activeEnvironmentLeases = 0;
/** True pre-test descriptors, captured once on the first install of a test. */
let capturedOriginals = null;
/** The shared stand-in environment every harness of the test operates on. */
let activeEnvironment = null;

/**
 * Installs window/document/RAF/observer stand-ins for the duration of the test.
 * The returned restore() must be called after every act()-driven unmount so
 * React never observes a half-restored global environment.
 *
 * Multi-harness safety: the true pre-test descriptors are captured exactly
 * once, on the first install (lease 0 -> 1), and the active environment
 * (listener tables, rAF queue, storage) is created once and shared by every
 * harness of the test. Later installs only bump the lease and hand out a
 * handle onto the same active environment. Each handle carries its own
 * released flag, so a double release can never consume another handle's
 * lease, and a stale handle can never release a later installation. The
 * actual restore runs when the last lease is released.
 */
export function setupSessionHookEnvironment() {
  const globalNames = [
    "window",
    "document",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "IS_REACT_ACT_ENVIRONMENT",
    "KeyboardEvent",
    "WheelEvent",
    "TouchEvent",
    "Element",
    "ResizeObserver",
  ];
  if (activeEnvironmentLeases === 0) {
    capturedOriginals = new Map(globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    activeEnvironment = createEnvironment();
  }
  activeEnvironmentLeases += 1;
  let released = false;
  return {
    restore() {
      if (released) return;
      released = true;
      activeEnvironmentLeases -= 1;
      if (activeEnvironmentLeases > 0) return;
      for (const [name, descriptor] of capturedOriginals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
      capturedOriginals = null;
      activeEnvironment = null;
      activeEnvironmentLeases = 0;
    },
    get windowListeners() {
      return activeEnvironment.windowListeners;
    },
    get documentListeners() {
      return activeEnvironment.documentListeners;
    },
    resize: (...args) => activeEnvironment.browser.resize(...args),
    resizeTargets: () => activeEnvironment.browser.resizeTargets(),
    windowEvent: (...args) => activeEnvironment.windowEvent(...args),
    documentEvent: (...args) => activeEnvironment.documentEvent(...args),
    setVisibility: (...args) => activeEnvironment.setVisibility(...args),
    flushRaf: (...args) => activeEnvironment.flushRaf(...args),
    flushRafUntilSettled: (...args) => activeEnvironment.flushRafUntilSettled(...args),
    rafSize: (...args) => activeEnvironment.rafSize(...args),
  };
}

/** Builds the shared stand-in environment; called only on the 0 -> 1 lease. */
function createEnvironment() {
  const browser = createBrowserObservers();
  const windowListeners = new Map();
  const documentListeners = new Map();
  const rafQueue = new Map();
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

  globalThis.KeyboardEvent = FakeKeyboardEvent;
  globalThis.WheelEvent = FakeWheelEvent;
  globalThis.TouchEvent = FakeTouchEvent;
  globalThis.Element = FakeElement;
  globalThis.ResizeObserver = browser.ResizeObserver;
  globalThis.requestAnimationFrame = (callback) => {
    const id = (rafSeq = (rafSeq ?? 0) + 1);
    rafQueue.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => rafQueue.delete(id);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.window = {
    navigator: { language: "en-US" },
    localStorage: { getItem: () => null },
    sessionStorage: memoryStorage(),
    addEventListener: recordListener(windowListeners),
    removeEventListener: unrecordListener(windowListeners),
  };
  globalThis.document = {
    documentElement: { lang: "en" },
    title: "",
    visibilityState: "visible",
    addEventListener: recordListener(documentListeners),
    removeEventListener: unrecordListener(documentListeners),
  };

  return {
    browser,
    windowListeners,
    documentListeners,
    windowEvent(type, event) {
      for (const fn of [...(windowListeners.get(type) ?? [])]) fn(event);
    },
    documentEvent(type, event) {
      for (const fn of [...(documentListeners.get(type) ?? [])]) fn(event);
    },
    setVisibility(state) {
      globalThis.document.visibilityState = state;
    },
    async flushRaf() {
      await act(async () => {
        const callbacks = [...rafQueue.values()];
        rafQueue.clear();
        for (const callback of callbacks) callback();
      });
    },
    /** Drains rAF passes (callbacks may schedule follow-ups) until quiet. */
    async flushRafUntilSettled(maxPasses = 4) {
      for (let pass = 0; pass < maxPasses; pass += 1) {
        if (rafQueue.size === 0) return;
        await this.flushRaf();
      }
      if (rafQueue.size !== 0) throw new Error("rAF queue did not settle");
    },
    rafSize() {
      return rafQueue.size;
    },
  };
}

/**
 * Builds a bundle exposing the real useAgentSession composition with the
 * real renderer client, translation and session policies. Only messages to the
 * external Host receive test replies.
 */
export async function createSessionHookBundle({ bundleName, host, extraEntryExports = "" }) {
  const { useAgentSession, resetRpc } = await importTestBundle(bundleName, {
    ...realRendererGraphOptions(ROOT),
    stdin: {
      contents:
        'export { useAgentSession } from "./src/renderer/hooks/useAgentSession.ts";\n' +
        'export {resetRpc} from "./src/renderer/lib/api-client.ts";\n' +
        extraEntryExports,
      resolveDir: ROOT,
      sourcefile: `${bundleName}-entry.ts`,
      loader: "ts",
    },
  });
  const boundary = installApiHostBridge(globalThis.window, () => host, resetRpc);
  return { useAgentSession, releaseHost: boundary.close };
}

/**
 * Renders the real hook inside a Probe component and exposes helpers for
 * mounting, remounting (session switch), event delivery and state access.
 */
let harnessSequence = 0;

export async function createSessionHookHarness(t, { bundleName, host, attach, extraEntryExports = "" }) {
  // Each instance owns a real client and port; several sessions can stay live
  // without replacing or sharing their external Host replies.
  const uniqueBundle = `${bundleName}-${(harnessSequence += 1)}`;
  const env = setupSessionHookEnvironment();
  const errorSpy = t.mock?.method?.(console, "error");
  let renderer;
  let releaseHost = () => {};
  t.after(() =>
    releaseAll(
      unmount,
      () => releaseHost(),
      () => errorSpy?.mock.restore(),
      () => env.restore(),
    ),
  );

  const bundle = await createSessionHookBundle({ bundleName: uniqueBundle, host, extraEntryExports });
  const { useAgentSession } = bundle;
  releaseHost = bundle.releaseHost;

  let latest;
  let latestOptions;
  let key = 0;

  function Probe() {
    latest = useAgentSession(latestOptions);
    attach?.(latest);
    return null;
  }

  async function mountWithOptions(options) {
    latestOptions = options;
    await act(async () => {
      renderer = TestRenderer.create(createElement(Probe, { key: ++key }));
    });
  }

  async function remountWithOptions(options) {
    latestOptions = options;
    await act(async () => {
      renderer.update(createElement(Probe, { key: ++key }));
    });
  }

  async function updateWithOptions(options) {
    latestOptions = options;
    await act(async () => {
      renderer.update(createElement(Probe, { key }));
    });
  }

  async function flush() {
    await act(async () => {
      await new Promise((resolve) => setImmediate(resolve));
    });
  }

  function emit(event, { sid } = {}) {
    const candidates = host.eventSinks.filter((sink) => sink.active && (!sid || sink.sid === sid));
    for (const sink of candidates) sink.onEvent(event);
    return candidates.length;
  }

  async function unmount() {
    if (!renderer) return;
    const active = renderer;
    renderer = null;
    await act(async () => active.unmount());
  }

  return {
    useAgentSession,
    host,
    env,
    act,
    get state() {
      return latest;
    },
    mount: mountWithOptions,
    remount: remountWithOptions,
    update: updateWithOptions,
    flush,
    emit,
    unmount,
    errorCalls() {
      return errorSpy?.mock.calls ?? [];
    },
  };
}
