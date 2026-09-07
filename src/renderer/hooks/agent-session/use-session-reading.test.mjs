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

  assert.ok(h.env.windowListeners.get("keydown")?.length > 0, "window keydown listener is attached");
  assert.ok(h.env.windowListeners.get("pointerdown")?.length > 0, "window pointerdown listener is attached");
  for (const type of ["wheel", "touchstart", "touchmove", "touchend", "touchcancel", "scroll"]) {
    assert.ok(surface.container.listeners.get(type)?.length > 0, `container ${type} listener is attached`);
  }
  assert.equal(h.env.resizeObservers.length, 1, "presence ResizeObserver is created");
  assert.ok(
    h.env.resizeObservers[0].observed.includes(surface.container),
    "ResizeObserver observes the scroll container",
  );
  assert.equal(h.state.isAwayFromBottom, true, "presence reflects the real scrolled-away geometry");
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

  assert.equal(h.env.windowListeners.get("keydown")?.length ?? 0, 0, "no window key listener when hidden");
  assert.equal(h.env.windowListeners.get("pointerdown")?.length ?? 0, 0, "no window pointer listener when hidden");
  for (const type of ["wheel", "touchstart", "touchmove", "touchend", "touchcancel", "scroll"]) {
    assert.equal(surface.container.listeners.get(type)?.length ?? 0, 0, `no container ${type} listener when hidden`);
  }
  assert.equal(h.env.resizeObservers.length, 0, "no presence ResizeObserver when hidden");
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
  assert.equal(h.env.resizeObservers.length, 0, "hidden surface is not observed");
  assert.equal(h.state.isAwayFromBottom, false, "hidden geometry is not treated as reading state");

  await h.update({ ...options, readingVisible: true });
  await h.flush();

  assert.ok(h.env.windowListeners.get("keydown")?.length > 0, "window listeners re-attach");
  assert.ok(surface.container.listeners.get("scroll")?.length > 0, "container listeners re-attach");
  assert.equal(h.env.resizeObservers.length, 1, "presence observer re-created");
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

  // Visible: everything installed. The presence observer may have been re-created
  // once when the initial history committed; the active one is the last.
  assert.ok(h.env.windowListeners.get("keydown")?.length > 0, "window keydown attached while visible");
  assert.ok(surface.container.listeners.get("scroll")?.length > 0, "container scroll attached while visible");
  assert.ok(h.env.resizeObservers.length >= 1, "a presence observer exists while visible");
  assert.equal(h.env.resizeObservers.at(-1).disconnectCount, 0, "the active observer is connected");
  assert.equal(h.state.isAwayFromBottom, true, "presence evaluated while visible");

  // Hide: every reading artifact must be torn down.
  await h.update({ ...options, readingVisible: false });
  await h.flush();
  assert.equal(h.env.windowListeners.get("keydown")?.length ?? 0, 0, "window keydown removed on hide");
  assert.equal(h.env.windowListeners.get("pointerdown")?.length ?? 0, 0, "window pointerdown removed on hide");
  for (const type of ["wheel", "touchstart", "touchmove", "touchend", "touchcancel", "scroll"]) {
    assert.equal(surface.container.listeners.get(type)?.length ?? 0, 0, `container ${type} removed on hide`);
  }
  assert.equal(h.env.resizeObservers.at(-1).disconnectCount, 1, "the active observer is disconnected on hide");
  assert.equal(h.env.rafSize(), 0, "no follow rAF while hidden");

  // The 30ms presence re-evaluation must not fire while hidden: move the
  // geometry to the near-bottom side and tick past the window. A live timer
  // would flip the presence; a cleared one leaves the last visible value.
  surface.container.scrollTop = 60;
  surface.container.scrollHeight = 200;
  surface.container.clientHeight = 120;
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
  assert.ok(h.env.windowListeners.get("keydown")?.length > 0, "window keydown re-attached on show");
  assert.ok(surface.container.listeners.get("scroll")?.length > 0, "container scroll re-attached on show");
  assert.equal(h.env.resizeObservers.at(-1).disconnectCount, 0, "a fresh observer is connected on show");
  assert.equal(h.state.isAwayFromBottom, false, "presence re-evaluated from the current geometry");
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
  assert.ok(h.env.rafSize() > 0, "visible page schedules the follow loop");

  await h.update({ session: createSessionDetail("follow").info, newSessionCwd: null, readingVisible: false });
  await h.flush();
  assert.equal(h.env.rafSize(), 0, "hidden page cancels the follow loop");

  await h.update({ session: createSessionDetail("follow").info, newSessionCwd: null, readingVisible: true });
  await h.flush();
  assert.ok(h.env.rafSize() > 0, "re-visible page resumes the follow loop");
});
