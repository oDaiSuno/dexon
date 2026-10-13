import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
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
 * visible→hidden→visible cycle with explicit observer/listener/frame/timer
 * registries. This is the composite accounting the helper/source tests cannot
 * provide on their own.
 */

const scrollContainerOf = (env) => env.root.querySelector(".overflow-y-auto");
const elementListenersOf = (env, element) => env.elementListeners.get(element) ?? new Map();
// jsdom's selector engine (@asamuzakjp/dom-selector) attaches window
// listeners named _handleFocusEvent/_handleKeyboardEvent/_handleMouseEvent
// once the DOM is used; filter them out so the reading delta is exact.
const readingWindowListeners = (env, type) =>
  (env.windowListeners.get(type) ?? []).filter((fn) => !fn.name.startsWith("_handle"));

const CONTAINER_READING_TYPES = ["wheel", "touchstart", "touchmove", "touchend", "touchcancel", "scroll"];
// scroll carries two listeners while visible: the reading position handler
// and the minimap's own scroll measurement; the touch/wheel types are reading
// only.
const CONTAINER_READING_EXPECTED = new Map([
  ["wheel", 1],
  ["touchstart", 1],
  ["touchmove", 1],
  ["touchend", 1],
  ["touchcancel", 1],
  ["scroll", 2],
]);

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
    reads: () => reads,
    writes: () => writes,
    scrollTop: () => scrollTopValue,
  };
}

const minimapElementOf = (env) =>
  [...env.root.querySelectorAll("div")].find(
    (element) => element.style?.width === "36px" && (element.style?.borderLeft ?? "").includes("var(--border)"),
  );

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
        holder.releaseHost();
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
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const env = installCompositionEnvironment();
  const detail = createSessionDetail("composition", { previousCursor: "older" });
  const host = createCompositionHost({ getSession: async () => detail });
  const teardown = createTeardown(t, env);
  const { ChatWindow, releaseHost } = await createChatWindowBundle(host);
  teardown.releaseHost = releaseHost;
  const h = createCompositionHarness(env, ChatWindow);
  teardown.h = h;

  await h.mount({ session: detail.info });
  await flushAsync();
  await env.flushRafUntilSettled();

  // Visible: every reading owner is attached exactly once.
  const scrollContainer = scrollContainerOf(env);
  assert.ok(scrollContainer, "the loaded chat renders a scroll container");
  assert.equal(env.activeResizeObservers().length, 3, "presence, viewport and minimap observers are active");
  assert.equal(env.activeIntersectionObservers().length, 1, "the history sentinel observer is active");
  assert.equal(readingWindowListeners(env, "keydown").length, 1, "window keydown is attached");
  assert.equal(readingWindowListeners(env, "pointerdown").length, 1, "window pointerdown is attached");
  for (const type of CONTAINER_READING_TYPES) {
    assert.equal(
      elementListenersOf(env, scrollContainer).get(type)?.length ?? 0,
      CONTAINER_READING_EXPECTED.get(type),
      `container ${type} attached`,
    );
  }

  // Hide: every reading artifact is torn down; old targets are released.
  await h.rerender({ visible: false });
  assert.equal(env.activeResizeObservers().length, 0, "no reading observer stays active while hidden");
  assert.equal(env.activeIntersectionObservers().length, 0, "the sentinel observer is disconnected while hidden");
  assert.equal(readingWindowListeners(env, "keydown").length, 0, "window keydown is removed");
  assert.equal(readingWindowListeners(env, "pointerdown").length, 0, "window pointerdown is removed");
  for (const type of CONTAINER_READING_TYPES) {
    assert.equal(elementListenersOf(env, scrollContainer).get(type)?.length ?? 0, 0, `container ${type} removed`);
  }
  assert.equal(env.rafQueue.size, 0, "no queued UI frames while hidden");

  // Zero hidden geometry reads/writes: the 30ms presence and 50ms minimap
  // timers must not re-read or re-write geometry after hiding. The counters
  // are installed after the visible-state reads so legitimate setup is not
  // counted against the hidden claim.
  const geometry = trackGeometry(scrollContainer, { clientHeight: 400, scrollHeight: 800, scrollTop: 0 });
  const scrollIntoViewBefore = env.scrollIntoViewCalls.length;
  const scrollToBefore = env.scrollToCalls.length;
  const readsBefore = geometry.reads();
  const writesBefore = geometry.writes();
  t.mock.timers.tick(100);
  await flushAsync();
  assert.equal(env.scrollIntoViewCalls.length, scrollIntoViewBefore, "no scrollIntoView while hidden");
  assert.equal(env.scrollToCalls.length, scrollToBefore, "no scrollTo while hidden");
  assert.equal(geometry.reads(), readsBefore, "no hidden geometry reads after the timer windows");
  assert.equal(geometry.writes(), writesBefore, "no hidden geometry writes after the timer windows");
  assert.equal(geometry.scrollTop(), 0, "hidden scrollTop is never written");

  // Runtime keeps working while hidden: an agent event still updates the run.
  await act(async () => emit(host, { type: "agent_start" }));
  await flushAsync();
  assert.ok(env.root.querySelector(".chat-shimmer-text"), "the runtime continues while hidden");

  // Show: every owner re-attaches exactly once and observes the current target.
  await h.rerender({ visible: true });
  await flushAsync();
  assert.equal(env.activeResizeObservers().length, 3, "observers re-attach on show");
  assert.equal(env.activeIntersectionObservers().length, 1, "the sentinel re-attaches on show");
  assert.equal(readingWindowListeners(env, "keydown").length, 1, "window keydown re-attached");
  assert.equal(readingWindowListeners(env, "pointerdown").length, 1, "window pointerdown re-attached");
  for (const type of CONTAINER_READING_TYPES) {
    assert.equal(
      elementListenersOf(env, scrollContainer).get(type)?.length ?? 0,
      CONTAINER_READING_EXPECTED.get(type),
      `container ${type} re-attached`,
    );
  }
  const viewportObserver = env.activeResizeObservers().find((observer) => observer.observed.includes(scrollContainer));
  assert.ok(viewportObserver, "the viewport-height observer observes the current container");

  // Unmount: complete teardown of every reading owner.
  await h.unmount();
  assert.equal(env.activeResizeObservers().length, 0, "unmount disconnects every observer");
  assert.equal(env.activeIntersectionObservers().length, 0, "unmount disconnects the sentinel");
  assert.equal(env.rafQueue.size, 0, "unmount cancels every frame");
});

test("an active minimap drag and a pending follow frame are cancelled by hiding", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const env = installCompositionEnvironment();
  const detail = createSessionDetail("composition-drag");
  const host = createCompositionHost({ getSession: async () => detail });
  const teardown = createTeardown(t, env);
  const { ChatWindow, releaseHost } = await createChatWindowBundle(host);
  teardown.releaseHost = releaseHost;
  const h = createCompositionHarness(env, ChatWindow);
  teardown.h = h;

  await h.mount({ session: detail.info });
  await flushAsync();
  await env.flushRafUntilSettled();
  const scrollContainer = scrollContainerOf(env);
  assert.ok(scrollContainer, "the loaded chat renders a scroll container");

  // Controlled near-bottom geometry: the minimap becomes scrollable and an
  // external turn counts as near-bottom, so a follow frame can be scheduled.
  const geometry = trackGeometry(scrollContainer, { clientHeight: 400, scrollHeight: 800, scrollTop: 400 });
  for (const observer of env.activeResizeObservers()) observer.emit();
  await flushAsync();
  const minimap = minimapElementOf(env);
  assert.ok(minimap, "the minimap renders with scrollable geometry");

  // Schedule a follow frame non-vacuously BEFORE the drag: with the initial
  // scrollTop (400) the external turn counts as near-bottom and queues one
  // pending frame. The drag below rewrites scrollTop to 0, which is a visible
  // state write, not a hidden one.
  await act(async () => {
    emit(host, { type: "channel_turn_start" });
    emit(host, { type: "agent_start" });
  });
  await flushAsync();
  assert.equal(env.rafQueue.size, 1, "the follow loop queues exactly one frame before hiding");

  // Start a drag: mousedown installs window move/up listeners and writes
  // scrollTop once in the visible state; the follow frame stays pending.
  Object.defineProperty(minimap, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ top: 0, bottom: 400, height: 400 }),
  });
  const writesAfterDragStart = geometry.writes();
  await act(async () =>
    minimap.dispatchEvent(new env.dom.window.MouseEvent("mousedown", { bubbles: true, clientY: 100 })),
  );
  assert.equal(readingWindowListeners(env, "mousemove").length, 1, "the drag installs a window mousemove listener");
  assert.equal(readingWindowListeners(env, "mouseup").length, 1, "the drag installs a window mouseup listener");
  assert.ok(geometry.writes() > writesAfterDragStart, "the drag start writes scrollTop in the visible state");
  assert.equal(env.rafQueue.size, 1, "the drag does not cancel the pending follow frame");
  const scrollTopAfterDragStart = geometry.scrollTop();

  // Hide with the drag still active and the frame still pending.
  await h.rerender({ visible: false });
  assert.equal(env.rafQueue.size, 0, "hiding cancels the pending follow frame");
  assert.equal(readingWindowListeners(env, "mousemove").length, 0, "hiding removes the drag mousemove listener");
  assert.equal(readingWindowListeners(env, "mouseup").length, 0, "hiding removes the drag mouseup listener");
  assert.equal(geometry.scrollTop(), scrollTopAfterDragStart, "no hidden scrollTop write from the stopped drag");
  const readsAfterHide = geometry.reads();
  const writesAfterHide = geometry.writes();
  const scrollIntoViewBeforeHide = env.scrollIntoViewCalls.length;
  t.mock.timers.tick(100);
  await flushAsync();
  assert.equal(geometry.reads(), readsAfterHide, "no hidden geometry reads after the timer windows");
  assert.equal(geometry.writes(), writesAfterHide, "no hidden geometry writes after the timer windows");
  assert.equal(
    env.scrollIntoViewCalls.length,
    scrollIntoViewBeforeHide,
    "no scrollIntoView while hidden (follow frame never flushed)",
  );

  await h.unmount();
});

test("delayed element readiness attaches the viewport observer", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const env = installCompositionEnvironment();
  const detail = createSessionDetail("composition-delayed");
  let resolveSession;
  const host = createCompositionHost({
    getSession: () => new Promise((resolve) => (resolveSession = resolve)),
  });
  const teardown = createTeardown(t, env);
  const { ChatWindow, releaseHost } = await createChatWindowBundle(host);
  teardown.releaseHost = releaseHost;
  const h = createCompositionHarness(env, ChatWindow);
  teardown.h = h;

  await h.mount({ session: detail.info });
  await flushAsync();
  assert.equal(scrollContainerOf(env), null, "the loading state has no scroll container");
  assert.equal(env.activeResizeObservers().length, 0, "no geometry observer before the element exists");

  await act(async () => resolveSession(detail));
  await flushAsync();
  await env.flushRafUntilSettled();
  const scrollContainer = scrollContainerOf(env);
  assert.ok(scrollContainer, "the loaded chat renders a scroll container");
  assert.equal(env.activeResizeObservers().length, 3, "observers attach after the element appears");
  const viewportObserver = env.activeResizeObservers().find((observer) => observer.observed.includes(scrollContainer));
  assert.ok(viewportObserver, "the viewport-height observer observes the late scroll container");

  await h.unmount();
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
  const following = await createChatWindowBundle(createCompositionHost());
  ordered.releases.push(following.releaseHost);
  assert.ok(following.ChatWindow, "a following fixture acquires successfully after the rejection");
  await following.releaseHost();
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
