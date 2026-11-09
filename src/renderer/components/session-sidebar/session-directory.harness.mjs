import { realRendererGraphOptions } from "../renderer-real-graph.mjs";
import { installPrimaryHost } from "../../hooks/agent-session/primary-host-test-fixture.mjs";
import { importTestBundle } from "#test-bundle";
import path from "node:path";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

const projectRoot = path.resolve(import.meta.dirname, "../../../..");

const { resetRpc, environmentRegistry, useEnvironmentDirectories } = await importTestBundle(
  "session-sidebar-directory",
  {
    stdin: {
      contents: [
        'export { useEnvironmentDirectories } from "./src/renderer/components/session-sidebar/use-environment-directories.ts";',
        'export { resetRpc } from "./src/renderer/lib/api-client.ts";',
        'export { environmentRegistry } from "./src/renderer/lib/environment-registry.ts";',
      ].join("\n"),
      resolveDir: projectRoot,
      sourcefile: "session-directory-test-entry.ts",
      loader: "ts",
    },
    tsconfig: path.join(projectRoot, "tsconfig.renderer.json"),
    external: ["react", "react-dom", "react-dom/*"],
    ...realRendererGraphOptions(projectRoot),
  },
);

export function session(id, overrides = {}) {
  return {
    id,
    path: `/fixture/${id}.jsonl`,
    created: "2026-07-15T12:00:00.000Z",
    name: "",
    firstMessage: "",
    cwd: "/workspace/dexon",
    modified: "2026-07-15T12:00:00.000Z",
    messageCount: 1,
    ...overrides,
  };
}

export function createStorage() {
  const store = new Map();
  return {
    store,
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
}

export function respondWithSessions(sessionsList, runningSessionIds = []) {
  return (method) => {
    if (method === "sessions.list") return { sessions: sessionsList, runningSessionIds };
    if (method === "system.home") return { home: "/Users/tester" };
    throw new Error(`unexpected Host request: ${method}`);
  };
}

const TIMED_GLOBALS = ["window", "setTimeout", "clearTimeout", "IS_REACT_ACT_ENVIRONMENT"];

function createMicrotaskChannel() {
  const listeners = [new Map(), new Map()];
  let closed = false;
  const ports = listeners.map((events, index) => ({
    addEventListener(type, listener) {
      const set = events.get(type) ?? new Set();
      set.add(listener);
      events.set(type, set);
    },
    removeEventListener(type, listener) {
      events.get(type)?.delete(listener);
    },
    start() {},
    postMessage(data) {
      if (closed) throw new Error("Session directory Host port is closed");
      const message = structuredClone(data);
      globalThis.queueMicrotask(() => {
        if (closed) return;
        for (const listener of listeners[1 - index].get("message") ?? []) listener({ data: message });
      });
    },
    close() {
      if (closed) return;
      closed = true;
      for (const events of listeners) {
        for (const listener of events.get("close") ?? []) listener();
      }
    },
  }));
  return { port1: ports[0], port2: ports[1] };
}

async function installEnvironment({ responses, storage, scheduler } = {}) {
  const originals = new Map(TIMED_GLOBALS.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const store = storage ?? createStorage();
  const sessionChangedListeners = [];
  const cleanups = [];

  let reply = responses;
  let generation = 1;

  const harness = {
    call(method, params) {
      if (!reply) throw new Error(`unexpected Host request: ${method}`);
      return reply(method, params);
    },
    subscribeSessionsChanged(listener) {
      sessionChangedListeners.push(listener);
      return Promise.resolve(() => {
        const index = sessionChangedListeners.indexOf(listener);
        if (index >= 0) sessionChangedListeners.splice(index, 1);
      });
    },
  };

  resetRpc();
  globalThis.window = {
    location: { href: "http://localhost/" },
    localStorage: store,
    addEventListener() {},
    removeEventListener() {},
  };
  if (scheduler) {
    globalThis.setTimeout = scheduler.setTimeout;
    globalThis.clearTimeout = scheduler.clearTimeout;
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const hostBoundary = installPrimaryHost(
    globalThis.window,
    {
      "sessions.list": (params) => harness.call("sessions.list", params),
      "system.home": (params) => harness.call("system.home", params),
    },
    {
      createChannel: createMicrotaskChannel,
      subscribe: (topic, _key, listener) =>
        topic === "sessions.changed" ? harness.subscribeSessionsChanged(listener) : () => {},
    },
  );
  environmentRegistry.initialize();
  await globalThis.window.piBridge.listEnvironments();

  return {
    store,
    setReplies(nextReply) {
      reply = nextReply;
    },
    running(payload) {
      hostBoundary.emit("agent.running", "*", { type: "running", ...payload });
    },
    restart() {
      hostBoundary.publish(++generation);
    },
    sessionChanged(event) {
      for (const listener of [...sessionChangedListeners]) listener(event);
    },
    ownCleanup(cleanup) {
      cleanups.push(cleanup);
    },
    async restore() {
      const errors = [];
      for (const cleanup of cleanups.reverse()) {
        try {
          await cleanup();
        } catch (error) {
          errors.push(error);
        }
      }
      try {
        resetRpc();
      } catch (error) {
        errors.push(error);
      }
      try {
        hostBoundary.close();
      } catch (error) {
        errors.push(error);
      }
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
      if (errors.length) throw new AggregateError(errors, "Session directory cleanup failed");
    },
  };
}

export function createProbe() {
  const state = { value: undefined };
  function Probe({ hookArgs }) {
    state.value = useEnvironmentDirectories(hookArgs).find((directory) => directory.environment.id === "primary");
    return null;
  }
  return { state, Probe };
}

export async function mountProbe(env, Probe, hookArgs) {
  let renderer;
  let mounted = true;
  const unmount = async () => {
    if (!mounted) return;
    mounted = false;
    await act(async () => renderer?.unmount());
  };
  env.ownCleanup(unmount);
  await act(async () => {
    renderer = create(createElement(Probe, { hookArgs }));
  });
  return {
    update: async (nextArgs) => {
      await act(async () => {
        renderer.update(createElement(Probe, { hookArgs: nextArgs }));
      });
    },
    unmount,
  };
}

export async function withEnvironment(options, run) {
  const env = await installEnvironment(options);
  try {
    await run(env);
  } finally {
    await env.restore();
  }
}
