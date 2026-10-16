import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { byRole, mouseDown } from "../../../tests/support/dom-events.mjs";
import { createSessionDetail } from "../hooks/agent-session/session-hook-harness.mjs";
import {
  createChatWindowBundle,
  createCompositionHarness,
  createCompositionHost,
  flushAsync,
  installCompositionEnvironment,
} from "./chat-window-composition.harness.mjs";

/**
 * Retained ChatWindow composition evidence (ASTRA-R5-G001.2): the actual
 * ChatWindow assembly — real useChatWindow/useAgentSession, ChatInput,
 * ChatMinimap, history sentinel and viewport-height owners — driven through a
 * visible→hidden→visible cycle through browser target notifications and actual
 * DOM events. Visible results and released targets remain stable when reading
 * ownership is reorganized; no positive observer or listener count is fixed.
 */

const scrollContainerOf = (env) => byRole(env.root, "region", "Conversation");
const elementListenersOf = (env, element) => env.elementListeners.get(element) ?? new Map();
const CONTAINER_READING_TYPES = ["wheel", "touchstart", "touchmove", "touchend", "touchcancel", "scroll"];

const emit = (host, event) => {
  for (const sink of host.eventSinks.filter((s) => s.active)) sink.onEvent(event);
};

/**
 * Installs controlled geometry with read/write counters on the scroll
 * container, so hidden presence/minimap reevaluation (which reads geometry)
 * and drag/scroll writes become observable.
 */
function trackGeometry(container, { clientHeight, scrollHeight, scrollTop }) {
  let reads = 0;
  let writes = 0;
  let scrollTopValue = scrollTop;
  Object.defineProperty(container, "clientHeight", {
    configurable: true,
    get() {
      reads += 1;
      return clientHeight;
    },
  });
  Object.defineProperty(container, "scrollHeight", {
    configurable: true,
    get() {
      reads += 1;
      return scrollHeight;
    },
  });
  Object.defineProperty(container, "scrollTop", {
    configurable: true,
    get() {
      reads += 1;
      return scrollTopValue;
    },
    set(value) {
      writes += 1;
      scrollTopValue = value;
    },
  });
  return {
    set(values) {
      if (values.clientHeight !== undefined) clientHeight = values.clientHeight;
      if (values.scrollHeight !== undefined) scrollHeight = values.scrollHeight;
      if (values.scrollTop !== undefined) scrollTopValue = values.scrollTop;
    },
    reads: () => reads,
    writes: () => writes,
    scrollTop: () => scrollTopValue,
  };
}

const minimapElementOf = (env) => byRole(env.root, "region", "Conversation minimap");
const bottomButtonOf = (env) => env.root.querySelector('[aria-label="Scroll to bottom"]');
const sentinelOf = (env) => byRole(env.root, "group", "Earlier messages");

function notifyReadingSurface(env, container) {
  env.resize(container);
  container.dispatchEvent(new env.dom.window.Event("scroll"));
  container.dispatchEvent(new env.dom.window.WheelEvent("wheel", { deltaY: -10 }));
  env.dom.window.dispatchEvent(new env.dom.window.KeyboardEvent("keydown", { key: "PageUp" }));
}

function assertReleased(env, container) {
  assert.equal(env.resizeTargets().size, 0, "no released page target remains observed for size changes");
  assert.equal(env.intersectionTargets().size, 0, "no released page target remains observed for intersection changes");
  assert.equal(env.rafQueue.size, 0, "unmount leaves no owned browser frame");
  assert.equal(env.clock.pendingCount(), 0, "unmount leaves no owned browser task");
  for (const type of CONTAINER_READING_TYPES) {
    assert.equal(elementListenersOf(env, container).get(type)?.length ?? 0, 0, `unmount releases container ${type}`);
  }
}

/**
 * Registers guaranteed teardown BEFORE any fallible bundle acquisition: a
 * rejection must still restore the environment and host (ASTRA-R7-F001). The
 * holder is filled in after acquisition succeeds; unmount is a no-op when no
 * root was ever mounted, and each cleanup stage runs even if an earlier one
 * throws. The returned cleanup() is the exact registered function, idempotent
 * so the after-hook and an explicit in-test call cannot double-restore.
 */
function createTeardown(t, env) {
  const holder = { h: null, releaseHost: () => {} };
  let cleanupRun = false;
  const cleanup = async () => {
    if (cleanupRun) return;
    cleanupRun = true;
    try {
      if (holder.h) await holder.h.unmount();
    } finally {
      try {
        await holder.releaseHost();
      } finally {
        env.restore();
      }
    }
  };
  // Attach cleanup to the SAME object the closure reads, so later mutations
  // like `teardown.releaseHost = ...` are visible when the hook runs.
  t.after(cleanup);
  holder.cleanup = cleanup;
  return holder;
}

test("retained ChatWindow hides reading work while the runtime continues", async (t) => {
  const env = installCompositionEnvironment();
  const detail = createSessionDetail("composition", { previousCursor: "older" });
  const pages = [];
  const host = createCompositionHost({
    getSession: async () => detail,
    getSessionContextPage: async (...params) => {
      pages.push(params);
      return { context: { messages: [], entryIds: [], historyRevision: "r", previousCursor: null }, truncated: false };
    },
  });
  const teardown = createTeardown(t, env);
  const { ChatWindow, releaseHost } = await createChatWindowBundle(host);
  teardown.releaseHost = releaseHost;
  const h = createCompositionHarness(env, ChatWindow);
  teardown.h = h;
  await h.mount({ session: detail.info });
  await flushAsync();
  await act(async () => env.flushRafUntilSettled());

  const container = scrollContainerOf(env);
  assert.ok(container, "the loaded chat renders a scroll container");
  const geometry = trackGeometry(container, { clientHeight: 400, scrollHeight: 800, scrollTop: 400 });
  await act(async () => env.resize(container));
  assert.equal(bottomButtonOf(env), null, "being at the latest message does not offer another jump");
  geometry.set({ scrollTop: 0 });
  await act(async () => env.resize(container));
  assert.ok(bottomButtonOf(env), "viewport changes expose the public return-to-latest action");
  assert.ok(minimapElementOf(env), "the visible overflowing conversation exposes its minimap");
  const sentinel = sentinelOf(env);
  assert.ok(sentinel, "older history is available before hiding");

  await h.rerender({ visible: false });
  assert.equal(byRole(env.root, "region", "Chat").hidden, true);
  const reads = geometry.reads();
  const writes = geometry.writes();
  const scrolls = env.scrollIntoViewCalls.length;
  const scrollTo = env.scrollToCalls.length;
  await act(async () => {
    notifyReadingSurface(env, container);
    env.intersect(sentinel, true);
    await env.clock.advanceBy(100);
    env.flushRafUntilSettled();
  });
  await flushAsync();
  assert.equal(env.scrollIntoViewCalls.length, scrolls, "no scrollIntoView while hidden");
  assert.equal(env.scrollToCalls.length, scrollTo, "no scrollTo while hidden");
  assert.equal(geometry.reads(), reads, "hidden browser events and elapsed time cause no layout reads");
  assert.equal(geometry.writes(), writes, "hidden browser events and elapsed time cause no scrolling");
  assert.deepEqual(pages, [], "a hidden history sentinel does not request another page");

  await act(async () => {
    emit(host, { type: "agent_start" });
    emit(host, {
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "A reply received while the page was hidden" }],
        timestamp: 3,
      },
    });
  });
  await flushAsync();
  assert.ok(
    env.root.textContent.includes("A reply received while the page was hidden"),
    "the real runtime retains a background reply",
  );
  assert.equal(geometry.reads(), reads, "background replies do not read hidden geometry");
  assert.equal(geometry.writes(), writes, "background replies do not scroll the hidden conversation");

  await h.rerender({ visible: true });
  await flushAsync();
  assert.equal(byRole(env.root, "region", "Chat").hidden, false);
  assert.ok(
    env.root.textContent.includes("A reply received while the page was hidden"),
    "the retained reply is available on return",
  );
  geometry.set({ scrollTop: 400 });
  await act(async () => env.resize(container));
  assert.equal(bottomButtonOf(env), null, "size changes update the returned view at the latest message");
  geometry.set({ scrollTop: 0 });
  await act(async () => env.resize(container));
  assert.ok(bottomButtonOf(env), "the returned view responds to geometry changes again");
  await act(async () => env.intersect(sentinelOf(env), true));
  await flushAsync();
  assert.equal(pages.length, 1, "visible history entry submits one page request");

  await h.unmount();
  assertReleased(env, container);
});

test("an active minimap drag and a pending follow frame are cancelled by hiding", async (t) => {
  const env = installCompositionEnvironment();
  const detail = createSessionDetail("composition-drag", { previousCursor: "older" });
  const host = createCompositionHost({ getSession: async () => detail });
  const teardown = createTeardown(t, env);
  const { ChatWindow, releaseHost } = await createChatWindowBundle(host);
  teardown.releaseHost = releaseHost;
  const h = createCompositionHarness(env, ChatWindow);
  teardown.h = h;
  await h.mount({ session: detail.info });
  await flushAsync();
  await act(async () => env.flushRafUntilSettled());
  const container = scrollContainerOf(env);
  const geometry = trackGeometry(container, { clientHeight: 400, scrollHeight: 800, scrollTop: 400 });
  await act(async () => env.resize(container));
  await act(async () => {
    emit(host, { type: "channel_turn_start" });
    emit(host, { type: "agent_start" });
  });
  await flushAsync();
  const beforeFollow = env.scrollIntoViewCalls.length;
  await act(async () => env.flushRafUntilSettled());
  assert.ok(env.scrollIntoViewCalls.length > beforeFollow, "a visible external turn follows its latest content");

  await act(async () =>
    emit(host, {
      type: "message_update",
      message: { role: "assistant", content: [{ type: "text", text: "A pending visible turn" }] },
    }),
  );
  await flushAsync();
  const minimap = minimapElementOf(env);
  assert.ok(minimap, "the visible conversation has a draggable minimap");
  Object.defineProperty(minimap, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ top: 0, bottom: 400, height: 400 }),
  });
  await mouseDown(minimap, { clientY: 100 });
  await act(async () => env.dom.window.dispatchEvent(new env.dom.window.MouseEvent("mousemove", { clientY: 200 })));
  assert.equal(geometry.scrollTop(), 200, "dragging the viewport halfway across its travel scrolls halfway down");
  await h.rerender({ visible: false });
  const reads = geometry.reads();
  const writes = geometry.writes();
  const scrolls = env.scrollIntoViewCalls.length;
  await act(async () => {
    env.dom.window.dispatchEvent(new env.dom.window.MouseEvent("mousemove", { clientY: 300 }));
    env.dom.window.dispatchEvent(new env.dom.window.MouseEvent("mouseup"));
    notifyReadingSurface(env, container);
    await env.clock.advanceBy(100);
    env.flushRafUntilSettled();
  });
  assert.equal(geometry.scrollTop(), 200, "continuing the old drag cannot move hidden content");
  assert.equal(geometry.reads(), reads, "the stopped drag and follow work perform no hidden measurement");
  assert.equal(geometry.writes(), writes, "the stopped drag and follow work perform no hidden write");
  assert.equal(env.scrollIntoViewCalls.length, scrolls, "a pending visible follow never scrolls after hiding");

  await h.rerender({ visible: true });
  const returnedMinimap = minimapElementOf(env);
  assert.ok(returnedMinimap, "the minimap returns with the visible page");
  Object.defineProperty(returnedMinimap, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ top: 0, bottom: 400, height: 400 }),
  });
  await mouseDown(returnedMinimap, { clientY: 100 });
  await act(async () => env.dom.window.dispatchEvent(new env.dom.window.MouseEvent("mousemove", { clientY: 200 })));
  assert.equal(geometry.scrollTop(), 400, "a new drag works after returning to the page");
  await h.unmount();
  assertReleased(env, container);
  assert.equal(env.windowListeners.get("mousemove")?.length ?? 0, 0, "unmount releases an active drag");
  assert.equal(env.windowListeners.get("mouseup")?.length ?? 0, 0, "unmount releases drag completion");
});

test("delayed element readiness attaches the viewport observer", async (t) => {
  const env = installCompositionEnvironment();
  const detail = createSessionDetail("composition-delayed", { previousCursor: "older" });
  let resolveSession;
  const host = createCompositionHost({ getSession: () => new Promise((resolve) => (resolveSession = resolve)) });
  const teardown = createTeardown(t, env);
  const { ChatWindow, releaseHost } = await createChatWindowBundle(host);
  teardown.releaseHost = releaseHost;
  const h = createCompositionHarness(env, ChatWindow);
  teardown.h = h;
  await h.mount({ session: detail.info });
  await flushAsync();
  assert.equal(scrollContainerOf(env), undefined, "the loading state has no scroll container");
  await act(async () => resolveSession(detail));
  await flushAsync();
  await act(async () => env.flushRafUntilSettled());
  const container = scrollContainerOf(env);
  assert.ok(container, "the loaded chat renders a scroll container");
  trackGeometry(container, { clientHeight: 400, scrollHeight: 800, scrollTop: 0 });
  await act(async () => env.resize(container));
  assert.ok(bottomButtonOf(env), "a late viewport responds to the same browser size notification");
  assert.ok(minimapElementOf(env), "late content becomes available in the minimap");
  await h.unmount();
  assertReleased(env, container);
});

/**
 * Installs a writable, configurable sentinel fetch and registers one ordered
 * teardown: it releases every entry pushed onto `ordered.releases` (host
 * bindings, fixture environments) BEFORE restoring the baseline fetch
 * descriptor, on success and on every early failure (ASTRA-R9-F001). The hook
 * is registered before the first mutation of the borrowed global, so neither
 * the sentinel nor a simulated absence can leak (ASTRA-R10-F001).
 * `startAbsent` simulates an originally absent fetch (ASTRA-R8-F002): the
 * baseline is then "no property", `ordered.checks` observe that baseline, and
 * the genuine entry descriptor always returns last.
 */
function createOrderedFetchTeardown(t, { startAbsent = false } = {}) {
  const sentinelFetch = async () => ({ ok: true, sentinel: true });
  const entryFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  const originalFetch = startAbsent ? undefined : entryFetch;
  const ordered = { releases: [], checks: [], sentinelFetch, originalFetch };
  t.after(async () => {
    try {
      try {
        for (const release of ordered.releases) await release();
      } finally {
        if (originalFetch) Object.defineProperty(globalThis, "fetch", originalFetch);
        else delete globalThis.fetch;
      }
      for (const check of ordered.checks) check();
    } finally {
      if (entryFetch) Object.defineProperty(globalThis, "fetch", entryFetch);
      else delete globalThis.fetch;
    }
  });
  if (startAbsent) delete globalThis.fetch;
  Object.defineProperty(globalThis, "fetch", { configurable: true, writable: true, value: sentinelFetch });
  return ordered;
}

test("a rejecting bundle acquisition restores the environment and host", async (t) => {
  // One ordered teardown owns the nested release: the acquired host and the
  // fixture environment are restored BEFORE the outer original fetch returns,
  // on success and on every early failure (ASTRA-R9-F001).
  const ordered = createOrderedFetchTeardown(t);

  const env = installCompositionEnvironment();
  // Register consumer cleanup BEFORE the fallible acquisition: this placement
  // is the consumer contract being regression-tested (ASTRA-R7-F001).
  const teardown = createTeardown(t, env);
  ordered.releases.push(() => teardown.cleanup());
  await assert.rejects(createChatWindowBundle(createCompositionHost(), { failAcquisition: true }));

  // Observation while the fixture environment is still installed: no separate
  // unconditional restoration path may satisfy these assertions (R8-F001).
  assert.equal(
    Object.getOwnPropertyDescriptor(globalThis, "__compositionHost"),
    undefined,
    "the host binding is released when acquisition fails",
  );
  assert.notEqual(globalThis.fetch, ordered.sentinelFetch, "the fixture fetch remains installed during the test");

  // Execute the REGISTERED cleanup: the inner environment restore returns
  // fetch to the intermediate sentinel descriptor the environment captured;
  // the outer original returns only via the ordered teardown hook.
  await teardown.cleanup();
  assert.equal(
    globalThis.fetch,
    ordered.sentinelFetch,
    "the registered cleanup restores the environment's captured prior fetch",
  );
  assert.equal(
    Object.getOwnPropertyDescriptor(globalThis, "__compositionHost"),
    undefined,
    "no host binding leaks into a following fixture",
  );

  // A following fixture acquires and releases cleanly from the restored state
  // (the outer fetch is still the sentinel here; only the ordered teardown
  // restores the genuine outer original at test end).
  const followingEnv = installCompositionEnvironment();
  const followingTeardown = createTeardown(t, followingEnv);
  ordered.releases.push(followingTeardown.cleanup);
  const following = await createChatWindowBundle(createCompositionHost());
  followingTeardown.releaseHost = following.releaseHost;
  assert.ok(following.ChatWindow, "a following fixture acquires successfully after the rejection");
  await followingTeardown.cleanup();
  assert.equal(
    Object.getOwnPropertyDescriptor(globalThis, "__compositionHost"),
    undefined,
    "the following fixture releases its host binding cleanly",
  );

  // Registered after the ordered teardown, this hook runs last and compares
  // the complete original outer fetch descriptor; the originally absent
  // configuration has its own regression below.
  t.after(() => {
    assert.deepEqual(
      Object.getOwnPropertyDescriptor(globalThis, "fetch"),
      ordered.originalFetch,
      "the ordered teardown restores the complete original outer fetch descriptor",
    );
  });
});

test("the ordered teardown alone restores a rejecting acquisition", async (t) => {
  // Early-failure equivalent (ASTRA-R9-F001): an exception before the explicit
  // cleanup leaves only the registered hooks. The ordered teardown alone must
  // release the inner environment and host before the outer original fetch
  // returns; no unconditional emergency restore may satisfy the observations.
  const ordered = createOrderedFetchTeardown(t);

  const env = installCompositionEnvironment();
  const teardown = createTeardown(t, env);
  ordered.releases.push(() => teardown.cleanup());
  await assert.rejects(createChatWindowBundle(createCompositionHost(), { failAcquisition: true }));

  // Observation with no explicit cleanup following: the hooks must perform
  // the whole ordered release.
  assert.equal(
    Object.getOwnPropertyDescriptor(globalThis, "__compositionHost"),
    undefined,
    "the host binding is released when acquisition fails",
  );
  assert.notEqual(globalThis.fetch, ordered.sentinelFetch, "the fixture fetch remains installed during the test");

  // Runs after the ordered teardown: the complete original fetch descriptor
  // must be back and no host binding may remain.
  t.after(() => {
    assert.deepEqual(
      Object.getOwnPropertyDescriptor(globalThis, "fetch"),
      ordered.originalFetch,
      "hook-only release still restores the complete original outer fetch descriptor",
    );
    assert.equal(
      Object.getOwnPropertyDescriptor(globalThis, "__compositionHost"),
      undefined,
      "hook-only release leaves no host binding",
    );
  });
});

test("an originally absent fetch is absent again after the ordered release", async (t) => {
  // Portability configuration (ASTRA-R8-F002 lineage): fetch does not exist
  // before the test, so the ordered teardown must delete the property again
  // instead of leaving the sentinel installed.
  assert.equal(
    Object.getOwnPropertyDescriptor(globalThis, "fetch")?.configurable,
    true,
    "fetch is deletable in this runtime",
  );
  // The helper captures the entry descriptor and registers its restore BEFORE
  // it deletes fetch, so the simulated absence cannot outlive this test.
  const ordered = createOrderedFetchTeardown(t, { startAbsent: true });

  const env = installCompositionEnvironment();
  const teardown = createTeardown(t, env);
  ordered.releases.push(() => teardown.cleanup());
  await assert.rejects(createChatWindowBundle(createCompositionHost(), { failAcquisition: true }));

  assert.equal(
    Object.getOwnPropertyDescriptor(globalThis, "__compositionHost"),
    undefined,
    "the host binding is released when acquisition fails",
  );
  assert.notEqual(globalThis.fetch, ordered.sentinelFetch, "the fixture fetch remains installed during the test");

  await teardown.cleanup();
  assert.equal(
    globalThis.fetch,
    ordered.sentinelFetch,
    "the registered cleanup restores the environment's captured prior fetch",
  );

  // Runs inside the ordered teardown: after the baseline is restored and
  // before the genuine entry descriptor returns.
  ordered.checks.push(() => {
    assert.equal(
      Object.getOwnPropertyDescriptor(globalThis, "fetch"),
      undefined,
      "the originally absent fetch is absent again after the ordered release",
    );
    assert.equal(
      Object.getOwnPropertyDescriptor(globalThis, "__compositionHost"),
      undefined,
      "no host binding remains in the absent-fetch configuration",
    );
  });
});
