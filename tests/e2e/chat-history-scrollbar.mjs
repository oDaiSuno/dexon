import assert from "node:assert/strict";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const SCROLLBAR_GUTTER_PX = 16;
export const FOLLOW_TOLERANCE_PX = 80;

export async function pointerDrag(sendInputEvent, { from, to, steps = 12, stepMs = 30, holdMs = 0 }) {
  const x = Math.round(from.x);
  const startY = Math.round(from.y);
  const endY = Math.round(to.y);
  sendInputEvent({ type: "mouseMove", x, y: startY });
  sendInputEvent({ type: "mouseDown", x, y: startY, button: "left", clickCount: 1 });
  if (holdMs > 0) await sleep(holdMs);
  for (let step = 1; step <= steps; step += 1) {
    const y = Math.round(startY + ((endY - startY) * step) / steps);
    sendInputEvent({ type: "mouseMove", x, y, modifiers: ["leftButtonDown"] });
    await sleep(stepMs);
  }
  sendInputEvent({ type: "mouseUp", x, y: endY, button: "left", clickCount: 1 });
  await sleep(stepMs);
}

export function createScrollbarTools({ js, sendInputEvent, waitFor }) {
  const readState = () => js("window.chatHistory.state()");
  const thumbAt = (targetScrollTop) => js(`window.chatHistory.thumb(${Math.round(targetScrollTop)})`);

  function assertScrollbarGutter(state, context) {
    const reserved = state.offsetWidth - state.clientWidth;
    assert.notEqual(
      state.scrollbarWidth,
      "none",
      `the conversation does not hide its scrollbar ${context} (scrollbar-width: ${state.scrollbarWidth})`,
    );
    assert.equal(
      reserved,
      SCROLLBAR_GUTTER_PX,
      `the conversation reserves the shared 8px scrollbar on each edge ${context} (offset ${state.offsetWidth} - client ${state.clientWidth} = ${reserved}px, scrollbar-width: ${state.scrollbarWidth}, scrollbar-gutter: ${state.scrollbarGutter})`,
    );
  }

  function assertThumbShown(state, context) {
    assert.ok(
      state.scrollHeight > state.clientHeight,
      `the conversation shows a scrollbar thumb ${context} (scrollHeight ${state.scrollHeight} vs clientHeight ${state.clientHeight})`,
    );
  }

  function assertScrollbar(state, context) {
    assertScrollbarGutter(state, context);
    assertThumbShown(state, context);
  }

  async function thumbNow() {
    const thumb = await js("window.chatHistory.thumb()");
    assert.ok(thumb, "the conversation is on screen");
    return thumb;
  }

  async function dragThumbTo(targetScrollTop, options = {}) {
    const from = await thumbNow();
    await pointerDrag(sendInputEvent, { from, to: await thumbAt(targetScrollTop), ...options });
    return readState();
  }

  async function dragThumbUp(pixels, options = {}) {
    const from = await thumbNow();
    await pointerDrag(sendInputEvent, { from, to: { ...from, y: from.y - pixels }, ...options });
    return readState();
  }

  async function press(point) {
    const x = Math.round(point.x);
    const y = Math.round(point.y);
    sendInputEvent({ type: "mouseMove", x, y });
    sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
    await sleep(30);
  }

  async function release(point) {
    const x = Math.round(point.x);
    const y = Math.round(point.y);
    sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
    await sleep(30);
  }

  async function startReply() {
    await js("window.chatHistory.startStream()");
    await waitFor("window.chatHistory.state().streaming && window.chatHistory.state().spacer > 0", 20_000);
    await sleep(700);
    return readState();
  }

  async function endReply() {
    await js("window.chatHistory.stopStream()");
    await sleep(300);
  }

  async function scrollToBottomButton() {
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      const rect = await js("window.chatHistory.button('Scroll to bottom')");
      if (rect) return rect;
      await sleep(100);
    }
    throw new Error("the Scroll to bottom button never appears while the reader holds a position during a reply");
  }

  async function waitForFollowing(label, timeoutMs = 8_000) {
    const deadline = Date.now() + timeoutMs;
    let state = await readState();
    while (Date.now() < deadline) {
      if (Math.abs(state.distanceToLiveEnd) <= FOLLOW_TOLERANCE_PX) return state;
      await sleep(100);
      state = await readState();
    }
    throw new Error(
      `${label}: the reply never returns to following the latest content (still ${state.distanceToLiveEnd}px from the content end after ${timeoutMs}ms)`,
    );
  }

  async function assertGestureHolds(measurement, released, label, samples = 12, intervalMs = 200) {
    Object.assign(measurement, {
      released: Math.round(released.scrollTop),
      releasedDistance: released.distanceToLiveEnd,
      clientHeight: released.clientHeight,
    });
    assert.ok(
      released.distanceToLiveEnd >= released.clientHeight / 2,
      `${label}: the reply stops following the reader's gesture (after it the reader is ${released.distanceToLiveEnd}px above the latest reply, where one screen is ${released.clientHeight}px)`,
    );
    const states = [];
    for (let step = 0; step < samples; step += 1) {
      await sleep(intervalMs);
      states.push(await readState());
    }
    const tops = states.map((state) => state.scrollTop);
    const highest = Math.max(...tops);
    const lowest = Math.min(...tops);
    const trail = tops.map((top) => Math.round(top)).join(", ");
    Object.assign(measurement, {
      samples: tops.map((top) => Math.round(top)),
      distances: states.map((state) => state.distanceToLiveEnd),
      pulledBack: Math.round(highest - released.scrollTop),
    });
    assert.ok(
      highest - released.scrollTop <= 60,
      `${label}: the reader stays where the gesture left them instead of being pulled back to the latest content (left ${released.distanceToLiveEnd}px above the latest reply, then ${trail})`,
    );
    assert.ok(
      released.scrollTop - lowest <= 60,
      `${label}: the thumb does not drift away from where it was released (left at ${Math.round(released.scrollTop)}, then ${trail})`,
    );
    return tops;
  }

  // The reply keeps growing through the whole sample window, so a one-off scroll
  // to the bottom falls behind the new content end while a real follow keeps up.
  async function assertFollowsLatest(
    measurement,
    label = "after the Scroll to bottom button",
    samples = 14,
    intervalMs = 200,
  ) {
    const start = await readState();
    const screen = start.clientHeight;
    const rows = [];
    for (let step = 0; step < samples; step += 1) {
      await sleep(intervalMs);
      const state = await readState();
      rows.push({ height: state.scrollHeight, distance: state.distanceToLiveEnd });
    }
    const growth = rows.at(-1).height - start.scrollHeight;
    const half = Math.ceil(samples / 2);
    const tailRows = rows.slice(half);
    const tailGrowth = rows.at(-1).height - rows[half].height;
    const distances = rows.map((row) => Math.round(row.distance));
    const bound = Math.min(160, screen / 2);
    Object.assign(measurement, {
      follow: { growth: Math.round(growth), distances, screen },
    });
    assert.ok(
      growth >= screen * 0.75,
      `${label}: the reply keeps growing the page after the button (grew ${Math.round(growth)}px where one screen is ${screen}px)`,
    );
    assert.ok(
      tailGrowth >= screen * 0.3,
      `${label}: the reply still grows through the second half of the sample window (grew ${Math.round(tailGrowth)}px where one screen is ${screen}px)`,
    );
    const worst = Math.max(...tailRows.map((row) => Math.abs(row.distance)));
    assert.ok(
      worst <= bound,
      `${label}: the view keeps tracking the new content end while the reply grows (distance from the content end: ${distances.join(", ")}, bound ${Math.round(bound)}px)`,
    );
    return rows;
  }

  return {
    readState,
    assertScrollbar,
    assertScrollbarGutter,
    assertThumbShown,
    thumbNow,
    dragThumbTo,
    dragThumbUp,
    press,
    release,
    startReply,
    endReply,
    scrollToBottomButton,
    waitForFollowing,
    assertGestureHolds,
    assertFollowsLatest,
  };
}
