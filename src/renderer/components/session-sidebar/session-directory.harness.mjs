import { realRendererGraphOptions } from "../renderer-real-graph.mjs";
import { installRendererApi } from "../../../../tests/support/renderer-api.mjs";
import { importTestBundle } from "#test-bundle";
import path from "node:path";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

// Characterization tests for the split-out session directory owner. They pin
// the current behavior of the sidebar data model: list loading, the live
// running stream authority, host restarts, unread transitions, incremental
// change events, persistence, and the sidebar-owned timers.

const projectRoot = path.resolve(import.meta.dirname, "../../../..");

const { resetRpc, installApiShims, useSessionDirectory } = await importTestBundle("session-sidebar-directory", {
  stdin: {
    contents:
      'export { useSessionDirectory } from "./src/renderer/components/session-sidebar/session-directory.ts";' +
      '\nexport {resetRpc} from "./src/renderer/lib/api-client.ts"; export {installApiShims} from "./src/renderer/lib/api-fetch.ts";',
    resolveDir: projectRoot,
    sourcefile: "session-directory-test-entry.ts",
    loader: "ts",
  },
  tsconfig: path.join(projectRoot, "tsconfig.renderer.json"),
  external: ["react", "react-dom", "react-dom/*"],
  ...realRendererGraphOptions(projectRoot),
});

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

function installEnvironment({ responses, storage, scheduler } = {}) {
  const originals = new Map(TIMED_GLOBALS.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const store = storage ?? createStorage();
  const restartHandlers = [];
  const sessionChangedListeners = [];
  const cleanups = [];

  let reply = responses;

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

  globalThis.__sessionDirectoryHarness = harness;
  globalThis.window = {
    location: { href: "http://localhost/" },
    localStorage: store,
    piBridge: {
      onHostRestarted: (handler) => {
        restartHandlers.push(handler);
        return () => {
          const index = restartHandlers.indexOf(handler);
          if (index >= 0) restartHandlers.splice(index, 1);
        };
      },
    },
    addEventListener() {},
    removeEventListener() {},
  };
  if (scheduler) {
    globalThis.setTimeout = scheduler.setTimeout;
    globalThis.clearTimeout = scheduler.clearTimeout;
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const hostBoundary = installRendererApi(
    globalThis.window,
    { installApiShims, resetRpc },
    () => globalThis.__sessionDirectoryHarness,
  );

  return {
    store,
    setReplies(nextReply) {
      reply = nextReply;
    },
    running(payload) {
      hostBoundary.emit("agent.running", "*", { type: "running", ...payload });
    },
    restart() {
      for (const handler of [...restartHandlers]) handler();
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
        hostBoundary.close();
      } catch (error) {
        errors.push(error);
      }
      delete globalThis.__sessionDirectoryHarness;
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
    state.value = useSessionDirectory(hookArgs);
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
  const env = installEnvironment(options);
  try {
    await run(env);
  } finally {
    await env.restore();
  }
}
