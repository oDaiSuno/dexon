import { importTestBundle } from "#test-bundle";
import path from "node:path";
import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import {
  FakeElement,
  FakeKeyboardEvent,
  FakeResizeObserver,
  FakeTouchEvent,
  FakeWheelEvent,
  createReadingSurface,
  createSessionDetail,
  memoryStorage,
} from "./session-hook-fixtures.mjs";

export { createReadingSurface, createSessionDetail };

/**
 * Shared harness for exercising the real useAgentSession composition
 * (agent-session/* modules) against stubbed host RPCs.
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

export const API_CLIENT_NAMES = [
  "agentState",
  "call",
  "cancelModelsRefresh",
  "getSession",
  "getSessionContext",
  "getSessionContextPage",
  "getSessionEntryContent",
  "listModels",
  "newAgent",
  "refreshModels",
  "subscribeAgentEvents",
  "subscribeSessionsChanged",
];

export const AGENT_CLIENT_NAMES = ["sendAgentCommand"];

export function createSessionTestHost(overrides = {}) {
  const eventSinks = [];
  const changeSinks = [];
  const sendCommands = [];
  const getCommands = [];
  const autoTitleRequests = [];
  const i18nKeys = [];
  const recordRpc = async (rpc, sid, ...rest) => {
    getCommands.push({ rpc, sid, args: rest });
    const fn = overrides[rpc];
    if (typeof fn !== "function") throw new Error(`${rpc} is not configured in the harness host`);
    return fn(sid, ...rest);
  };
  const delegateApi =
    (name) =>
    (...args) => {
      const fn = overrides[name];
      if (typeof fn !== "function") throw new Error(`${name} is not configured in the harness host`);
      return fn(...args);
    };
  return {
    eventSinks,
    changeSinks,
    sendCommands,
    getCommands,
    autoTitleRequests,
    i18nKeys,
    subscribeAgentEvents:
      overrides.subscribeAgentEvents ??
      ((sid, onEvent) => {
        const sink = { sid, onEvent, active: true };
        eventSinks.push(sink);
        return Promise.resolve(() => {
          sink.active = false;
        });
      }),
    subscribeSessionsChanged:
      overrides.subscribeSessionsChanged ??
      ((onChange) => {
        changeSinks.push(onChange);
        return Promise.resolve(() => {
          onChange.active = false;
        });
      }),
    listModels:
      overrides.listModels ??
      (async () => ({
        models: [],
        nameMap: {},
        thinkingLevels: {},
        thinkingLevelMaps: {},
        catalog: { source: "cache", refreshed: false, aborted: false, warnings: [] },
        defaultModel: null,
      })),
    newAgent: delegateApi("newAgent"),
    refreshModels: delegateApi("refreshModels"),
    cancelModelsRefresh: delegateApi("cancelModelsRefresh"),
    sendAgentCommand(sid, payload) {
      sendCommands.push({ sid, payload });
      const fn = overrides.sendAgentCommand;
      if (typeof fn !== "function") return {};
      return fn(sid, payload);
    },
    getSession: (sid, ...rest) => recordRpc("getSession", sid, ...rest),
    getSessionContext: (sid, ...rest) => recordRpc("getSessionContext", sid, ...rest),
    getSessionContextPage: (sid, ...rest) => recordRpc("getSessionContextPage", sid, ...rest),
    getSessionEntryContent: (sid, ...rest) => recordRpc("getSessionEntryContent", sid, ...rest),
    agentState: (sid, ...rest) => recordRpc("agentState", sid, ...rest),
    // External RPC boundary of the real auto-session-title module. The title
    // request is recorded here; the local eligibility policy is not doubled.
    call(method, params) {
      if (method !== "agent.generateTitle") throw new Error("api-client.call is not configured in the harness host");
      autoTitleRequests.push(params);
      return Promise.resolve({ title: null });
    },
    t: overrides.t ?? ((_key, fallback) => fallback),
  };
}

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
    FakeResizeObserver.instances = [];
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
    get resizeObservers() {
      return FakeResizeObserver.instances;
    },
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
  globalThis.ResizeObserver = FakeResizeObserver;
  globalThis.requestAnimationFrame = (callback) => {
    const id = (rafSeq = (rafSeq ?? 0) + 1);
    rafQueue.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => rafQueue.delete(id);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.window = {
    localStorage: { getItem: () => null },
    sessionStorage: memoryStorage(),
    addEventListener: recordListener(windowListeners),
    removeEventListener: unrecordListener(windowListeners),
  };
  globalThis.document = {
    title: "",
    visibilityState: "visible",
    addEventListener: recordListener(documentListeners),
    removeEventListener: unrecordListener(documentListeners),
  };

  return {
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
 * host RPC layer and i18n replaced by harness delegates. Auto-title runs the
 * real module: only its `call` RPC reaches the harness host.
 */
export async function createSessionHookBundle(t, { bundleName, host, extraEntryExports = "" }) {
  const globalName = `__sessionHookHost_${bundleName.replace(/[^a-zA-Z0-9]/g, "_")}`;
  globalThis[globalName] = host;
  t.after(() => {
    delete globalThis[globalName];
  });

  const delegate = (module, names) =>
    names
      .map(
        (name) =>
          `export function ${name}(...args) { const host = globalThis.${globalName}; const fn = host?.${name}; ` +
          `if (typeof fn !== "function") throw new Error("${module}.${name} is not configured in the harness host"); ` +
          `return fn(...args); }`,
      )
      .join("\n");

  const { useAgentSession } = await importTestBundle(bundleName, {
    packages: "external",
    tsconfig: path.resolve(ROOT, "tsconfig.renderer.json"),
    stdin: {
      contents: 'export { useAgentSession } from "./src/renderer/hooks/useAgentSession.ts";\n' + extraEntryExports,
      resolveDir: ROOT,
      sourcefile: `${bundleName}-entry.ts`,
      loader: "ts",
    },
    plugins: [
      {
        name: "session-hook-stubs",
        setup(build) {
          build.onResolve({ filter: /(^|\/)api-client$/ }, () => ({ path: "api", namespace: "session-hook" }));
          build.onResolve({ filter: /(^|\/)agent-client$/ }, () => ({ path: "agent", namespace: "session-hook" }));
          build.onResolve({ filter: /^@\/i18n$/ }, () => ({ path: "i18n", namespace: "session-hook" }));
          build.onLoad({ filter: /.*/, namespace: "session-hook" }, ({ path: modulePath }) => ({
            contents:
              modulePath === "i18n"
                ? `const t = (key, fallback) => { globalThis.${globalName}?.i18nKeys?.push(key); return fallback; };` +
                  'export const useI18n = () => ({ t, language: "en" });'
                : modulePath === "agent"
                  ? delegate("agent-client", AGENT_CLIENT_NAMES, globalName)
                  : delegate("api-client", API_CLIENT_NAMES, globalName),
            loader: "js",
          }));
        },
      },
    ],
  });
  return { useAgentSession };
}

/**
 * Renders the real hook inside a Probe component and exposes helpers for
 * mounting, remounting (session switch), event delivery and state access.
 */
let harnessSequence = 0;

export async function createSessionHookHarness(t, { bundleName, host, attach, extraEntryExports = "" }) {
  // Every harness instance needs its own global host slot: several harnesses
  // may live in one test file and the bundle delegates resolve the slot by
  // name at call time.
  const uniqueBundle = `${bundleName}-${(harnessSequence += 1)}`;
  const env = setupSessionHookEnvironment();
  const errorSpy = t.mock?.method?.(console, "error");
  let renderer;

  t.after(async () => {
    if (renderer) {
      await act(async () => renderer.unmount());
      renderer = null;
    }
    errorSpy?.mock.restore();
    env.restore();
  });

  const { useAgentSession } = await createSessionHookBundle(t, { bundleName: uniqueBundle, host, extraEntryExports });

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
    await act(async () => renderer.unmount());
    renderer = null;
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
