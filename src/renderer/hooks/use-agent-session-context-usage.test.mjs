import { realRendererGraphOptions } from "../components/renderer-real-graph.mjs";
import { installApiHostBridge } from "../../../tests/support/api-host.mjs";
import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";

// Regression harness for the context-usage restore paths in useAgentSession.
// The real renderer client receives replies from another process's fixture; SessionControls renders the actual compact chip the user sees.
test("context usage survives session switches without a live runtime", async (parent) => {
  const root = path.resolve(import.meta.dirname, "../../..");
  const globalNames = [
    "window",
    "document",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "IS_REACT_ACT_ENVIRONMENT",
  ];
  const originals = new Map(globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const listen = () => {};
  globalThis.window = {
    navigator: { language: "en-US" },
    localStorage: { getItem: () => null },
    addEventListener: listen,
    removeEventListener: listen,
  };
  globalThis.document = {
    documentElement: { lang: "en" },
    visibilityState: "visible",
    addEventListener: listen,
    removeEventListener: listen,
  };
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  parent.after(() => {
    delete globalThis.__contextUsageHarness;
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });

  const { useAgentSession, SessionControls, resetRpc } = await importTestBundle("use-agent-session-context-usage", {
    packages: "external",
    tsconfig: path.join(root, "tsconfig.renderer.json"),
    stdin: {
      contents:
        'export { useAgentSession } from "./src/renderer/hooks/useAgentSession.ts";\n' +
        'export { SessionControls } from "./src/renderer/components/chat-input/SessionControls.tsx";\n' +
        'export {resetRpc} from "./src/renderer/lib/api-client.ts";',
      resolveDir: root,
      sourcefile: "context-usage-test-entry.ts",
      loader: "ts",
    },
    ...realRendererGraphOptions(root),
  });

  const USAGE = { percent: 30.2, contextWindow: 100_000_000, tokens: 30_200_000 };
  const UNKNOWN_AFTER_COMPACTION = { percent: null, contextWindow: 100_000_000, tokens: null };

  function hostWithDefaults(host) {
    return {
      async subscribeAgentEvents() {
        return () => {};
      },
      async subscribeSessionsChanged() {
        return () => {};
      },
      async listModels() {
        return { models: [], catalog: { source: "cache", refreshed: false, aborted: false, warnings: [] } };
      },
      ...host,
    };
  }

  function createSessionDetail(id, options = {}) {
    return {
      sessionId: id,
      filePath: `/fixture/${id}.jsonl`,
      info: {
        id,
        path: `/fixture/${id}.jsonl`,
        cwd: "/fixture",
        created: "",
        modified: "",
        messageCount: 2,
        firstMessage: "fixture",
      },
      leafId: `${id}-assistant`,
      tree: [],
      stats: {
        userMessages: 1,
        assistantMessages: 1,
        toolCalls: 0,
        toolResults: 0,
        totalMessages: 2,
        tokens: { input: 30_199_900, output: 100, cacheRead: 0, cacheWrite: 0, total: 30_200_000 },
        cost: 0,
      },
      context: {
        messages: [
          { role: "user", content: "fixture", timestamp: 1 },
          {
            role: "assistant",
            content: [{ type: "text", text: "fixture reply" }],
            provider: "fixture",
            model: "fixture-model",
            usage: {
              input: 30_199_900,
              output: 100,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 30_200_000,
              cost: { total: 0 },
            },
            stopReason: "stop",
            timestamp: 2,
          },
        ],
        entryIds: [`${id}-user`, `${id}-assistant`],
        model: { provider: "fixture", modelId: "fixture-model" },
        thinkingLevel: "off",
        historyRevision: `${id}-revision`,
        totalMessages: 2,
        loadedMessages: 2,
        truncatedBefore: false,
      },
      ...(options.agentState !== undefined ? { agentState: options.agentState } : { agentState: { running: false } }),
      ...(options.contextUsage !== undefined ? { contextUsage: options.contextUsage } : {}),
    };
  }

  function createHarness(t, host) {
    globalThis.__contextUsageHarness = hostWithDefaults(host);
    const boundary = installApiHostBridge(globalThis.window, () => globalThis.__contextUsageHarness, resetRpc);
    let latest;
    let renderer;
    let key = 0;
    function Probe({ detail }) {
      latest = useAgentSession({ session: detail.info, newSessionCwd: null });
      return createElement(SessionControls, {
        isMobile: false,
        isStreaming: false,
        closeDropdowns() {},
        thinkingLevel: "off",
        thinkingDropdownOpen: false,
        onThinkingToggle() {},
        thinkingContainerRef: { current: null },
        thinkingButtonRef: { current: null },
        onCompact() {},
        contextUsage: latest.contextUsage,
      });
    }
    t.after(async () => {
      try {
        if (renderer) await act(async () => renderer.unmount());
      } finally {
        boundary.close();
        delete globalThis.__contextUsageHarness;
      }
    });
    return {
      Probe,
      get state() {
        return latest;
      },
      text() {
        return JSON.stringify(renderer?.toJSON() ?? "");
      },
      assertSettled() {
        assert.equal(latest.loading, false);
        assert.equal(latest.error, null);
      },
      async mount(detail) {
        await act(async () => {
          renderer = TestRenderer.create(createElement(Probe, { key: ++key, detail }));
        });
        this.assertSettled();
      },
      /** Mount without waiting for the load to finish (controlled pending request). */
      async mountPending(detail) {
        await act(async () => {
          renderer = TestRenderer.create(createElement(Probe, { key: ++key, detail }));
        });
      },
      async switchTo(detail) {
        await act(async () => {
          renderer.update(createElement(Probe, { key: ++key, detail }));
        });
        this.assertSettled();
      },
      async flush() {
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
        });
      },
    };
  }

  await parent.test("restores the reconstructed usage when the host has no live session", async (t) => {
    const detail = createSessionDetail("restored", { contextUsage: USAGE });
    const h = createHarness(t, {
      async getSession() {
        return detail;
      },
    });
    await h.mount(detail);
    assert.deepEqual(h.state.contextUsage, USAGE);
    assert.equal(h.state.messages[0].role, "user");
  });

  await parent.test("keeps the live runtime authoritative when one exists", async (t) => {
    const live = { percent: 12.5, contextWindow: 100_000_000, tokens: 12_500_000 };
    const detail = createSessionDetail("live", {
      agentState: { running: true, state: { contextUsage: live, isStreaming: false, isPromptRunning: false } },
    });
    const h = createHarness(t, {
      async getSession() {
        return detail;
      },
    });
    await h.mount(detail);
    assert.deepEqual(h.state.contextUsage, live);
  });

  await parent.test("renders an explicit unknown after compaction instead of stale numbers", async (t) => {
    const detail = createSessionDetail("unknown", { contextUsage: UNKNOWN_AFTER_COMPACTION });
    const h = createHarness(t, {
      async getSession() {
        return detail;
      },
    });
    await h.mount(detail);
    assert.deepEqual(h.state.contextUsage, UNKNOWN_AFTER_COMPACTION);
  });

  await parent.test("does not fabricate usage when the host cannot compute it", async (t) => {
    const detail = createSessionDetail("missing", {});
    const h = createHarness(t, {
      async getSession() {
        return detail;
      },
    });
    await h.mount(detail);
    assert.equal(h.state.contextUsage, null);
  });

  await parent.test("a late response for an abandoned session cannot overwrite the active one", async (t) => {
    const usageB = { percent: 44, contextWindow: 100_000_000, tokens: 44_000_000 };
    let resolveA;
    const detailA = createSessionDetail("slow-a", { contextUsage: USAGE });
    const detailB = createSessionDetail("fast-b", { contextUsage: usageB });
    const h = createHarness(t, {
      getSession(id) {
        if (id !== "slow-a") return Promise.resolve(detailB);
        return new Promise((resolve) => {
          resolveA = resolve;
        });
      },
    });

    await h.mountPending(detailA);
    await h.switchTo(detailB);
    assert.deepEqual(h.state.contextUsage, usageB);

    await h.flush();
    resolveA?.(detailA);
    await h.flush();
    assert.deepEqual(h.state.contextUsage, usageB, "the stale response must not replace session B's usage");
  });
});
