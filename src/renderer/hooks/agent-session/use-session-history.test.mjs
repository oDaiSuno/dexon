import assert from "node:assert/strict";
import test from "node:test";

import {
  createReadingSurface,
  createSessionDetail,
  createSessionHookHarness,
  createSessionTestHost,
} from "./session-hook-harness.mjs";

test("a late initial-history response cannot overwrite a newer navigation", async (t) => {
  const detailA = createSessionDetail("s-1", {
    historyRevision: "rev-a",
    messages: [
      { role: "user", content: "a-initial", timestamp: 1 },
      { role: "assistant", content: [{ type: "text", text: "a reply" }], timestamp: 2 },
    ],
    entryIds: ["a-user", "a-assistant"],
  });
  let resolveA;
  const host = createSessionTestHost({
    getSession: () => new Promise((resolve) => (resolveA = resolve)),
    getSessionContext: async () => ({
      context: {
        messages: [{ role: "user", content: "nav-context", timestamp: 9 }],
        entryIds: ["nav-1"],
        historyRevision: "rev-nav",
        previousCursor: null,
      },
    }),
    agentState: async () => ({ running: false, state: {} }),
  });
  const h = await createSessionHookHarness(t, { bundleName: "history-stale", host });

  await h.mount({ session: detailA.info, newSessionCwd: null });
  await h.flush();
  assert.equal(h.state.messages.length, 0, "the initial load is still in flight");

  await h.act(async () => {
    await h.state.handleNavigate("nav-1");
  });
  await h.flush();
  assert.deepEqual(
    h.state.messages.map((m) => m.content),
    ["nav-context"],
    "navigation committed",
  );

  resolveA(detailA);
  await h.flush();
  assert.deepEqual(
    h.state.messages.map((m) => (typeof m.content === "string" ? m.content : "assistant")),
    ["nav-context"],
    "the stale initial response did not replace the newer navigation",
  );
});

test("a session that no longer exists clears the view without an error banner", async (t) => {
  const detail = createSessionDetail("gone");
  const host = createSessionTestHost({
    getSession: async () => {
      throw new Error("Session not found: gone");
    },
  });
  const h = await createSessionHookHarness(t, { bundleName: "history-gone", host });

  await h.mount({ session: detail.info, newSessionCwd: null });
  await h.flush();
  assert.equal(h.state.data, null, "detail cleared");
  assert.equal(h.state.error, null, "not-found is a defined outcome, not an error");
  assert.deepEqual(h.state.messages, []);
});

test("loading older history prepends and preserves the reading offset", async (t) => {
  const surface = createReadingSurface({ scrollTop: 100, scrollHeight: 400, clientHeight: 200 });
  const container = surface.container;
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
  commitRaf();
  assert.equal(container.scrollTop, 400, "viewport offset kept stable by the height delta");
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
  });
  const h = await createSessionHookHarness(t, { bundleName: "history-older-stale", host });
  await h.mount({ session: detail.info, newSessionCwd: null });
  await h.flush();

  const loadPromise = h.state.loadOlder();
  await h.act(async () => {
    await h.state.handleNavigate("nav-1");
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
  });
  const h = await createSessionHookHarness(t, { bundleName: "history-deferred-stale", host });
  await h.mount({ session: detail.info, newSessionCwd: null });
  await h.flush();

  const pending = h.state.loadDeferredContent("d-1", 1);
  await h.act(async () => {
    await h.state.handleNavigate("nav-1");
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
