import assert from "node:assert/strict";
import test from "node:test";

import {
  createReadingAnchorElement,
  createReadingSurface,
  createSessionDetail,
  createSessionHookHarness,
  createSessionTestHost,
  installReadingAnchors,
} from "./session-hook-harness.mjs";

function trackHiddenGeometry(container) {
  const values = {
    scrollTop: container.scrollTop,
    scrollHeight: container.scrollHeight,
    clientHeight: container.clientHeight,
  };
  const counts = { reads: 0, writes: 0 };
  let hidden = false;
  for (const key of Object.keys(values)) {
    Object.defineProperty(container, key, {
      configurable: true,
      get() {
        if (hidden) counts.reads += 1;
        return values[key];
      },
      set(value) {
        if (hidden) counts.writes += 1;
        values[key] = value;
      },
    });
  }
  return {
    hide() {
      hidden = true;
    },
    show() {
      hidden = false;
    },
    reset() {
      counts.reads = 0;
      counts.writes = 0;
    },
    value(key) {
      return values[key];
    },
    counts,
  };
}

test("loading older history prepends and preserves the reading offset", async (t) => {
  const surface = createReadingSurface({ scrollTop: 100, scrollHeight: 400, clientHeight: 200 });
  const container = surface.container;
  let anchorTop = 200;
  installReadingAnchors(container, [createReadingAnchorElement(container, "older-1", () => anchorTop)]);
  const detail = createSessionDetail("s-1", {
    previousCursor: "cursor-1",
    historyRevision: "rev-1",
  });
  const host = createSessionTestHost({
    getSession: async () => detail,
    getSessionContextPage: async () => ({
      context: {
        messages: [{ role: "user", content: "old-1", timestamp: 1 }],
        entryIds: ["old-1"],
        historyRevision: "rev-1",
        previousCursor: null,
      },
    }),
  });
  let commitRaf;
  const h = await createSessionHookHarness(t, {
    bundleName: "history-older",
    host,
    attach(state) {
      state.scrollContainerRef.current = container;
      state.liveContentEndRef.current = surface.liveEnd;
      state.messagesEndRef.current = surface.messagesEnd;
    },
  });
  await h.mount({ session: detail.info, newSessionCwd: null });
  await h.flush();
  await h.env.flushRafUntilSettled();
  assert.equal(h.state.hasOlder, true, "a previous cursor advertises older history");

  commitRaf = 0;
  globalThis.requestAnimationFrame = (cb) => {
    commitRaf = cb;
    return 1;
  };
  await h.act(() => h.state.loadOlder());
  await h.flush();
  assert.equal(h.state.messages.length, 3, "page prepended");
  assert.equal(h.state.messages[0].content, "old-1");
  assert.equal(h.state.hasOlder, false, "cursor consumed");

  assert.equal(typeof commitRaf, "function", "scroll compensation scheduled");
  container.scrollHeight = 700;
  anchorTop = 500;
  commitRaf();
  assert.equal(container.scrollTop, 400, "the reading anchor keeps its offset in the viewport");
});

test("history pagination keeps data while hide cancels visual anchor compensation", async (t) => {
  const surface = createReadingSurface({ scrollTop: 100, scrollHeight: 400, clientHeight: 200 });
  let anchorTop = 200;
  installReadingAnchors(surface.container, [
    createReadingAnchorElement(surface.container, "older-hidden", () => anchorTop),
  ]);
  const geometry = trackHiddenGeometry(surface.container);
  const detail = createSessionDetail("s-1", { previousCursor: "cursor-1", historyRevision: "rev-1" });
  const visibleDetail = createSessionDetail("s-2", { previousCursor: "cursor-2", historyRevision: "rev-2" });
  let activeDetail = detail;
  let resolvePage;
  const host = createSessionTestHost({
    getSession: async () => activeDetail,
    getSessionContextPage: () => new Promise((resolve) => (resolvePage = resolve)),
  });
  const h = await createSessionHookHarness(t, {
    bundleName: "history-older-hidden",
    host,
    attach(state) {
      state.scrollContainerRef.current = surface.container;
      state.liveContentEndRef.current = surface.liveEnd;
      state.messagesEndRef.current = surface.messagesEnd;
    },
  });
  const options = { session: detail.info, newSessionCwd: null };
  await h.mount({ ...options, readingVisible: true });
  await h.flush();

  const loadPromise = h.state.loadOlder();
  await h.flush();
  await h.update({ ...options, readingVisible: false });
  geometry.hide();
  resolvePage({
    context: {
      messages: [{ role: "user", content: "old-hidden", timestamp: 0 }],
      entryIds: ["old-hidden"],
      historyRevision: "rev-1",
      previousCursor: null,
    },
  });
  await loadPromise;
  await h.flush();
  assert.ok(
    h.state.messages.some((message) => message.content === "old-hidden"),
    "history data remains accepted hidden",
  );
  assert.equal(h.env.rafSize(), 0, "a page completing after hide schedules no hidden compensation");
  assert.deepEqual(geometry.counts, { reads: 0, writes: 0 }, "hidden page completion performs no geometry work");
  geometry.show();
  surface.container.scrollHeight = 700;
  anchorTop = 500;
  geometry.reset();
  await h.update({ ...options, readingVisible: true });
  await h.flush();
  await h.env.flushRafUntilSettled();
  assert.equal(surface.container.scrollTop, 400, "show restores the anchor after a hidden page response");

  let resolveVisiblePage;
  host.getSessionContextPage = () => new Promise((resolve) => (resolveVisiblePage = resolve));
  activeDetail = visibleDetail;
  const visibleOptions = { session: visibleDetail.info, newSessionCwd: null };
  await h.remount({ ...visibleOptions, readingVisible: true });
  await h.flush();
  await h.env.flushRafUntilSettled();
  const visibleLoad = h.state.loadOlder();
  await h.flush();
  resolveVisiblePage({
    context: {
      messages: [{ role: "user", content: "old-visible", timestamp: -1 }],
      entryIds: ["old-visible"],
      historyRevision: "rev-2",
      previousCursor: null,
    },
  });
  await visibleLoad;
  await h.flush();
  surface.container.scrollHeight = 700;
  anchorTop = 500;
  const scrollTopBeforeHide = surface.container.scrollTop;
  await h.update({ ...visibleOptions, readingVisible: false });
  geometry.hide();
  await h.flush();
  assert.equal(h.env.rafSize(), 0, "hide cancels an already scheduled compensation frame");
  await h.env.flushRafUntilSettled();
  assert.equal(
    geometry.value("scrollTop"),
    scrollTopBeforeHide,
    "cancelled hidden compensation does not write scrollTop",
  );
  assert.deepEqual(geometry.counts, { reads: 0, writes: 0 }, "cancelled frame performs no hidden geometry work");

  geometry.show();
  geometry.reset();
  await h.update({ ...visibleOptions, readingVisible: true });
  await h.flush();
  await h.env.flushRafUntilSettled();
  assert.equal(surface.container.scrollTop, 400, "show restores the reading offset from visible geometry");
  assert.deepEqual(geometry.counts, { reads: 0, writes: 0 }, "show reconciliation performs no hidden geometry work");
});

test("a queued history frame cannot mutate a surface after unmount", async (t) => {
  const surface = createReadingSurface({ scrollTop: 100, scrollHeight: 400, clientHeight: 200 });
  installReadingAnchors(surface.container, []);
  const detail = createSessionDetail("s-1", { previousCursor: "cursor-1", historyRevision: "rev-1" });
  const host = createSessionTestHost({
    getSession: async () => detail,
    getSessionContextPage: async () => ({
      context: {
        messages: [{ role: "user", content: "old", timestamp: 0 }],
        entryIds: ["old"],
        historyRevision: "rev-1",
        previousCursor: null,
      },
    }),
  });
  const h = await createSessionHookHarness(t, {
    bundleName: "history-frame-unmount",
    host,
    attach(state) {
      state.scrollContainerRef.current = surface.container;
    },
  });
  await h.mount({ session: detail.info, newSessionCwd: null, readingVisible: true });
  await h.flush();
  await h.env.flushRafUntilSettled();
  const load = h.state.loadOlder();
  await h.flush();
  const scrollTopBeforeUnmount = surface.container.scrollTop;
  globalThis.cancelAnimationFrame = () => {};
  await load;
  await h.unmount();
  await h.env.flushRafUntilSettled();
  assert.equal(surface.container.scrollTop, scrollTopBeforeUnmount, "a late frame cannot write after unmount");
});

test("a stale generation drops an in-flight older page", async (t) => {
  const detail = createSessionDetail("s-1", { previousCursor: "cursor-1", historyRevision: "rev-1" });
  let resolvePage;
  const host = createSessionTestHost({
    getSession: async () => detail,
    getSessionContextPage: () => new Promise((resolve) => (resolvePage = resolve)),
    getSessionContext: async () => ({
      context: {
        messages: [{ role: "user", content: "nav-context", timestamp: 9 }],
        entryIds: ["nav-1"],
        historyRevision: "rev-nav",
        previousCursor: null,
      },
    }),
    agentState: async () => ({ running: false, state: {} }),
    sendAgentCommand: async (sid, payload) =>
      payload.type === "switch_version" ? { cancelled: false, leafId: "nav-1" } : {},
  });
  const h = await createSessionHookHarness(t, { bundleName: "history-older-stale", host });
  await h.mount({ session: detail.info, newSessionCwd: null });
  await h.flush();

  const loadPromise = h.state.loadOlder();
  await h.act(async () => {
    await h.state.handleSwitchVersion("nav-1");
  });
  await h.flush();
  resolvePage({
    context: {
      messages: [{ role: "user", content: "old-late", timestamp: 0 }],
      entryIds: ["old-late"],
      historyRevision: "rev-1",
      previousCursor: null,
    },
  });
  await loadPromise;
  await h.flush();
  assert.ok(!h.state.messages.some((m) => m.content === "old-late"), "late page discarded after navigation");
});

test("a stale cursor resets to a full reload", async (t) => {
  const detail = createSessionDetail("s-1", { previousCursor: "cursor-1", historyRevision: "rev-1" });
  let pageCalls = 0;
  const host = createSessionTestHost({
    getSession: async () => detail,
    getSessionContextPage: async () => {
      pageCalls += 1;
      throw new Error("STALE_CURSOR: cursor expired");
    },
  });
  const h = await createSessionHookHarness(t, { bundleName: "history-stale-cursor", host });
  await h.mount({ session: detail.info, newSessionCwd: null });
  await h.flush();

  await h.act(() => h.state.loadOlder());
  await h.flush();
  assert.equal(pageCalls, 1);
  assert.ok(host.getCommands.filter((c) => c.rpc === "getSession").length >= 2, "full reload after the stale cursor");
  assert.equal(h.state.error, null);
});

test("a revision mismatch between page and current history forces a full reload", async (t) => {
  const detail = createSessionDetail("s-1", { previousCursor: "cursor-1", historyRevision: "rev-1" });
  const host = createSessionTestHost({
    getSession: async () => detail,
    getSessionContextPage: async () => ({
      context: {
        messages: [{ role: "user", content: "old-1", timestamp: 1 }],
        entryIds: ["old-1"],
        historyRevision: "rev-changed",
        previousCursor: null,
      },
    }),
  });
  const h = await createSessionHookHarness(t, { bundleName: "history-revision", host });
  await h.mount({ session: detail.info, newSessionCwd: null });
  await h.flush();

  await h.act(() => h.state.loadOlder());
  await h.flush();
  assert.ok(host.getCommands.filter((c) => c.rpc === "getSession").length >= 2, "full reload instead of a bad prepend");
  assert.ok(!h.state.messages.some((m) => m.content === "old-1"), "the mismatched page was not prepended");
});

function deferredMessage(entryId) {
  return {
    role: "assistant",
    content: [
      { type: "text", text: "head", timestamp: 1 },
      { type: "text", text: "", deferredContent: { entryId, originalBytes: 100, contentType: "text" } },
    ],
    timestamp: 2,
  };
}

function entryContentHost(entryContentCalls) {
  return {
    getSessionEntryContent: async (sid, entryId, blockIndex) => {
      entryContentCalls.push(`${entryId}:${blockIndex}`);
      return {
        content: { type: "text", text: `full-${entryId}` },
        deferredContent: { entryId, originalBytes: 100 },
      };
    },
  };
}

test("deferred content replaces the placeholder block and keeps siblings", async (t) => {
  const detail = createSessionDetail("s-1", { messages: [deferredMessage("d-1")], entryIds: ["d-1"] });
  const entryContentCalls = [];
  const host = createSessionTestHost({
    getSession: async () => detail,
    ...entryContentHost(entryContentCalls),
  });
  const h = await createSessionHookHarness(t, { bundleName: "history-deferred", host });
  await h.mount({ session: detail.info, newSessionCwd: null });
  await h.flush();

  const first = h.state.loadDeferredContent("d-1", 1);
  const second = h.state.loadDeferredContent("d-1", 1);
  await Promise.all([first, second]);
  await h.flush();
  assert.equal(entryContentCalls.length, 1, "concurrent duplicates share one request");
  assert.equal(h.state.messages[0].content[0].text, "head", "sibling block untouched");
  assert.equal(h.state.messages[0].content[1].text, "full-d-1", "placeholder replaced");

  await h.state.loadDeferredContent("d-1", 1);
  await h.flush();
  assert.equal(entryContentCalls.length, 1, "cached result reused");
});

test("the deferred cache evicts the oldest key beyond the cap", async (t) => {
  const messages = Array.from({ length: 13 }, (_, i) => deferredMessage(`d-${i}`));
  const detail = createSessionDetail("s-1", {
    messages,
    entryIds: Array.from({ length: 13 }, (_, i) => `d-${i}`),
  });
  const entryContentCalls = [];
  const host = createSessionTestHost({
    getSession: async () => detail,
    ...entryContentHost(entryContentCalls),
  });
  const h = await createSessionHookHarness(t, { bundleName: "history-deferred-lru", host });
  await h.mount({ session: detail.info, newSessionCwd: null });
  await h.flush();

  for (let i = 0; i < 12; i += 1) await h.state.loadDeferredContent(`d-${i}`, 1);
  assert.equal(entryContentCalls.length, 12, "twelve distinct keys loaded");

  await h.state.loadDeferredContent("d-12", 1);
  assert.equal(entryContentCalls.length, 13, "the thirteenth key evicts the oldest");

  await h.state.loadDeferredContent("d-0", 1);
  assert.equal(entryContentCalls.length, 14, "the evicted key is fetched again");
});

test("a deferred response for a superseded generation is not applied", async (t) => {
  const detail = createSessionDetail("s-1", { messages: [deferredMessage("d-1")], entryIds: ["d-1"] });
  let resolveContent;
  const host = createSessionTestHost({
    getSession: async () => detail,
    getSessionEntryContent: () => new Promise((resolve) => (resolveContent = resolve)),
    getSessionContext: async () => ({
      context: {
        messages: [deferredMessage("d-1")],
        entryIds: ["d-1"],
        historyRevision: "rev-nav",
        previousCursor: null,
      },
    }),
    agentState: async () => ({ running: false, state: {} }),
    sendAgentCommand: async (sid, payload) =>
      payload.type === "switch_version" ? { cancelled: false, leafId: "nav-1" } : {},
  });
  const h = await createSessionHookHarness(t, { bundleName: "history-deferred-stale", host });
  await h.mount({ session: detail.info, newSessionCwd: null });
  await h.flush();

  const pending = h.state.loadDeferredContent("d-1", 1);
  await h.act(async () => {
    await h.state.handleSwitchVersion("nav-1");
  });
  await h.flush();
  resolveContent({
    content: { type: "text", text: "full-late" },
    deferredContent: { entryId: "d-1", originalBytes: 100 },
  });
  await pending;
  await h.flush();
  assert.equal(h.state.messages[0].content[1].text, "", "late deferred content not applied");
  assert.ok("deferredContent" in h.state.messages[0].content[1], "placeholder still pending");
});

test("switching sessions releases a stale load's performance marks when its reply arrives", async (t) => {
  let releaseOld;
  const old = createSessionDetail("trace-old");
  const next = createSessionDetail("trace-next");
  const host = createSessionTestHost({
    getSession: (sid) =>
      sid === "trace-old"
        ? new Promise((resolve) => {
            releaseOld = resolve;
          })
        : Promise.resolve(next),
  });
  const h = await createSessionHookHarness(t, { bundleName: "stale-session-trace", host });
  await h.mount({ session: old.info, newSessionCwd: null, readingVisible: false });
  await h.flush();
  const traceId = host.getCommands.find((command) => command.rpc === "getSession" && command.sid === "trace-old")
    .args[1];
  assert.ok(globalThis.performance.getEntriesByType("mark").some((entry) => entry.name.includes(traceId)));
  await h.remount({ session: next.info, newSessionCwd: null, readingVisible: false });
  await h.flush();
  await h.act(async () => releaseOld(old));
  await h.flush();
  assert.equal(
    globalThis.performance.getEntriesByType("mark").some((entry) => entry.name.includes(traceId)),
    false,
  );
  assert.equal(h.state.data.sessionId, "trace-next");
});

test("unmounting before visual commit releases the loaded session's performance marks", async (t) => {
  const detail = createSessionDetail("trace-unmount");
  const host = createSessionTestHost({ getSession: async () => detail });
  const h = await createSessionHookHarness(t, { bundleName: "unmount-session-trace", host });
  await h.mount({ session: detail.info, newSessionCwd: null, readingVisible: true });
  await h.flush();
  const traceId = host.getCommands.find((command) => command.rpc === "getSession").args[1];
  assert.ok(globalThis.performance.getEntriesByType("mark").some((entry) => entry.name.includes(traceId)));
  await h.unmount();
  assert.equal(
    globalThis.performance.getEntriesByType("mark").some((entry) => entry.name.includes(traceId)),
    false,
  );
});

test("a session refresh releases the replaced visual-commit trace", async (t) => {
  const detail = createSessionDetail("trace-refresh");
  const host = createSessionTestHost({ getSession: async () => detail });
  const h = await createSessionHookHarness(t, { bundleName: "replaced-session-trace", host });
  await h.mount({ session: detail.info, newSessionCwd: null, readingVisible: true });
  await h.flush();
  const first = host.getCommands.find((command) => command.rpc === "getSession").args[1];
  assert.ok(globalThis.performance.getEntriesByType("mark").some((entry) => entry.name.includes(first)));
  await h.act(async () => {
    for (const listener of host.changeSinks) listener({ sessionId: "trace-refresh" });
  });
  await h.flush();
  assert.ok(host.getCommands.filter((command) => command.rpc === "getSession").length >= 2);
  assert.equal(
    globalThis.performance.getEntriesByType("mark").some((entry) => entry.name.includes(first)),
    false,
  );
  await h.unmount();
});
