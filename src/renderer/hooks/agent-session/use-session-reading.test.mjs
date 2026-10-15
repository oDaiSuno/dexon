import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react-test-renderer";

import {
  createReadingSurface,
  createSessionDetail,
  createSessionHookHarness,
  createSessionTestHost,
} from "./session-hook-harness.mjs";

/** Geometry that is clearly scrolled away from the bottom (distance 180 > 96). */
const AWAY_SURFACE = () => createReadingSurface({ scrollTop: 0, scrollHeight: 300, clientHeight: 120 });

function readingSurfaceAttach(surface) {
  return (state) => {
    state.scrollContainerRef.current = surface.container;
    state.liveContentEndRef.current = surface.liveEnd;
    state.messagesEndRef.current = surface.messagesEnd;
    state.lastUserMsgRef.current = surface.lastUserMsg;
  };
}

test("reading wiring defaults to fully visible behavior", async (t) => {
  const surface = AWAY_SURFACE();
  const h = await createSessionHookHarness(t, {
    bundleName: "reading-default",
    host: createSessionTestHost(),
    attach: readingSurfaceAttach(surface),
  });

  await h.mount({ session: null, newSessionCwd: "/fixture" });
  await h.flush();

  assert.equal(h.state.isAwayFromBottom, true, "presence reflects the real scrolled-away geometry");
  surface.container.scrollTop = 180;
  await h.act(() => h.env.resize(surface.container));
  assert.equal(h.state.isAwayFromBottom, false, "viewport notifications update the visible reading position");
  surface.container.scrollTop = 0;
  await h.act(() => surface.container.dispatch("scroll", {}));
  assert.equal(h.state.isAwayFromBottom, true, "scrolling away updates the reader's return-to-bottom state");
});

test("readingVisible=false detaches reading activity while the runtime keeps working", async (t) => {
  const surface = AWAY_SURFACE();
  const agentStateCalls = [];
  const h = await createSessionHookHarness(t, {
    bundleName: "reading-hidden",
    host: createSessionTestHost({
      getSession: async () => createSessionDetail("hidden-run"),
      agentState: async () => {
        agentStateCalls.push(1);
        return { running: false, state: { isStreaming: false, isPromptRunning: false } };
      },
    }),
    attach: readingSurfaceAttach(surface),
  });

  // Mocks are enabled before mounting so every production timer (including the
  // runtime reconcile and extension intervals) is created through the mocked
  // APIs; a real interval alive at enable time could never be cleared.
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  await h.mount({
    session: createSessionDetail("hidden-run").info,
    newSessionCwd: null,
    readingVisible: false,
  });
  await h.flush();
  await h.env.flushRafUntilSettled();

  assert.equal(h.state.isAwayFromBottom, false, "hidden geometry is not treated as reading state");
  assert.equal(
    surface.messagesEnd.scrollIntoViewCalls.length,
    0,
    "hidden history load must not scroll (no reading intent)",
  );

  await h.act(() => {
    assert.equal(h.emit({ type: "agent_start" }), 1, "event stream still delivers events while hidden");
  });
  await h.flush();
  assert.equal(h.state.agentRunning, true, "runtime streaming state still updates while hidden");
  await h.act(() => {
    h.emit({ type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "tick" }] } });
  });
  await h.flush();
  await h.env.flushRafUntilSettled();
  assert.equal(h.state.streamState.isStreaming, true, "streaming state still updates while hidden");
  assert.equal(h.env.rafSize(), 0, "no follow rAF loop is scheduled while hidden");

  await act(async () => {
    t.mock.timers.tick(15_000);
  });
  await h.flush();
  assert.ok(agentStateCalls.length >= 1, "state reconcile keeps polling the host while hidden");
  assert.equal(h.state.agentRunning, false, "host-reported idle still finishes the run while hidden");
});

test("flipping readingVisible back on re-attaches reading and restores presence", async (t) => {
  const surface = AWAY_SURFACE();
  const h = await createSessionHookHarness(t, {
    bundleName: "reading-restore",
    host: createSessionTestHost({
      getSession: async () => createSessionDetail("restore"),
    }),
    attach: readingSurfaceAttach(surface),
  });

  const options = { session: createSessionDetail("restore").info, newSessionCwd: null };
  await h.mount({ ...options, readingVisible: false });
  await h.flush();
  assert.equal(h.state.isAwayFromBottom, false, "hidden geometry is not treated as reading state");

  await h.update({ ...options, readingVisible: true });
  await h.flush();

  assert.equal(h.state.isAwayFromBottom, true, "presence re-evaluated from real geometry");
});

test("a hidden page never masquerades zero geometry as scroll-to-bottom restoration", async (t) => {
  const surface = AWAY_SURFACE();
  const h = await createSessionHookHarness(t, {
    bundleName: "reading-no-ghost",
    host: createSessionTestHost({
      getSession: async () => createSessionDetail("ghost"),
    }),
    attach: readingSurfaceAttach(surface),
  });

  await h.mount({ session: createSessionDetail("ghost").info, newSessionCwd: null, readingVisible: false });
  await h.flush();
  assert.equal(surface.messagesEnd.scrollIntoViewCalls.length, 0, "hidden load never scrolls");

  await h.update({ session: createSessionDetail("ghost").info, newSessionCwd: null, readingVisible: true });
  await h.flush();
  assert.ok(
    surface.messagesEnd.scrollIntoViewCalls.length > 0,
    "becoming visible restores the initial reading position",
  );
});

test("hiding an active reading surface tears down listeners, observers and timers; showing restores them", async (t) => {
  const surface = AWAY_SURFACE();
  const h = await createSessionHookHarness(t, {
    bundleName: "reading-cleanup",
    host: createSessionTestHost({ getSession: async () => createSessionDetail("cleanup") }),
    attach: readingSurfaceAttach(surface),
  });

  // Mocks are enabled before mounting so every production timer (including the
  // runtime reconcile and the 30ms presence re-evaluation) is mocked.
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const options = { session: createSessionDetail("cleanup").info, newSessionCwd: null };
  await h.mount({ ...options, readingVisible: true });
  await h.flush();
  await h.env.flushRafUntilSettled();

  // Visible geometry is reflected through the public reading state.
  assert.equal(h.state.isAwayFromBottom, true, "presence evaluated while visible");

  // Hidden events and geometry must not change reading state.
  await h.update({ ...options, readingVisible: false });
  await h.flush();
  assert.equal(h.env.rafSize(), 0, "no follow rAF while hidden");

  // The 30ms presence re-evaluation must not fire while hidden: move the
  // geometry to the near-bottom side and tick past the window. A live timer
  // would flip the presence; a cleared one leaves the last visible value.
  surface.container.scrollTop = 60;
  surface.container.scrollHeight = 200;
  surface.container.clientHeight = 120;
  await h.act(() => {
    h.env.resize(surface.container);
    surface.container.dispatch("scroll", {});
  });
  await act(async () => {
    t.mock.timers.tick(30);
  });
  await h.flush();
  assert.equal(h.state.isAwayFromBottom, true, "hidden geometry is not re-evaluated as reading state");

  // Runtime keeps working while hidden.
  await h.act(() => {
    assert.equal(h.emit({ type: "agent_start" }), 1, "event stream still delivers events while hidden");
  });
  await h.flush();
  assert.equal(h.state.agentRunning, true, "runtime streaming state still updates while hidden");

  // Show again: everything re-installs and presence re-evaluates from the
  // current (now near-bottom) geometry.
  await h.update({ ...options, readingVisible: true });
  await h.flush();
  assert.equal(h.state.isAwayFromBottom, false, "presence re-evaluated from the current geometry");
  surface.container.scrollHeight = 600;
  await h.act(() => h.env.resize(surface.container));
  assert.equal(h.state.isAwayFromBottom, true, "visible size changes are handled again after returning");
});

test("the follow loop pauses while hidden and resumes after re-visibility", async (t) => {
  const surface = createReadingSurface({ scrollTop: 60, scrollHeight: 200, clientHeight: 120 });
  const h = await createSessionHookHarness(t, {
    bundleName: "reading-follow",
    host: createSessionTestHost({ getSession: async () => createSessionDetail("follow") }),
    attach: readingSurfaceAttach(surface),
  });

  await h.mount({ session: createSessionDetail("follow").info, newSessionCwd: null, readingVisible: true });
  await h.flush();
  await h.env.flushRafUntilSettled();

  await h.act(() => h.emit({ type: "agent_start" }));
  await h.flush();
  h.state.reattachAutoFollow();
  await h.flush();
  await h.act(() => {
    h.emit({ type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "tick" }] } });
  });
  await h.flush();
  const beforeVisible = surface.liveEnd.scrollIntoViewCalls.length;
  await h.env.flushRaf();
  assert.ok(surface.liveEnd.scrollIntoViewCalls.length > beforeVisible, "visible replies keep the newest text in view");

  await h.update({ session: createSessionDetail("follow").info, newSessionCwd: null, readingVisible: false });
  await h.flush();
  const beforeHidden = surface.liveEnd.scrollIntoViewCalls.length;
  await h.env.flushRaf();
  assert.equal(
    surface.liveEnd.scrollIntoViewCalls.length,
    beforeHidden,
    "hidden replies do not move the reading surface",
  );

  await h.update({ session: createSessionDetail("follow").info, newSessionCwd: null, readingVisible: true });
  await h.flush();
  const beforeRestored = surface.liveEnd.scrollIntoViewCalls.length;
  await h.env.flushRaf();
  assert.ok(
    surface.liveEnd.scrollIntoViewCalls.length > beforeRestored,
    "returning to the page resumes following replies",
  );
});
