import assert from "node:assert/strict";
import { FOLLOW_TOLERANCE_PX } from "./chat-history-scrollbar.mjs";

const THUMB_GESTURE_PX = 250;
const SENT_MESSAGE = "Next question after reading back";

export async function runScrollbarScenes(context) {
  const {
    payload,
    scene,
    loadFresh,
    prepareBottom,
    capture,
    clickAt,
    centre,
    wheelUp,
    sleep,
    js,
    waitFor,
    insertText,
    pressEnter,
    setContentSize,
    viewport,
    pickReadingSentence,
    measureArrival,
    lineHeight,
    tools,
  } = context;
  const {
    readState,
    assertScrollbar,
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
  } = tools;

  async function sendMessage(text) {
    const before = await readState();
    assert.equal(
      await js("window.chatHistory.focusComposer()"),
      true,
      "the composer takes focus before the reader types",
    );
    await insertText(text);
    await waitFor(`window.chatHistory.draft() === ${JSON.stringify(text)}`, 5_000);
    await pressEnter();
    await waitFor(`window.chatHistory.state().prompts === ${before.prompts + 1}`, 10_000);
  }

  await scene("scrollbar-shown-wide-and-narrow", async (measurement) => {
    await loadFresh(payload);
    await prepareBottom();
    const wide = await readState();
    Object.assign(measurement, {
      wide: {
        scrollTop: Math.round(wide.scrollTop),
        clientWidth: wide.clientWidth,
        offsetWidth: wide.offsetWidth,
        reserved: wide.offsetWidth - wide.clientWidth,
        scrollbarWidth: wide.scrollbarWidth,
        gutter: wide.scrollbarGutter,
      },
    });
    assert.ok(
      wide.scrollHeight > wide.clientHeight,
      `the loaded conversation is longer than one screen (${wide.scrollHeight} vs ${wide.clientHeight})`,
    );
    assertScrollbar(wide, "in a wide window");
    const wideScreenshot = await capture("07-scrollbar-wide");

    await setContentSize(620, viewport.height);
    await waitFor("!window.chatHistory.navigator().present", 10_000);
    const narrow = await readState();
    Object.assign(measurement, {
      narrow: {
        clientWidth: narrow.clientWidth,
        offsetWidth: narrow.offsetWidth,
        reserved: narrow.offsetWidth - narrow.clientWidth,
        scrollbarWidth: narrow.scrollbarWidth,
        navigator: narrow.navigator,
      },
    });
    assert.equal(narrow.navigator, false, "a narrow window hides the turn navigator");
    assertScrollbar(narrow, "once the turn navigator is hidden");
    const narrowScreenshot = await capture("08-scrollbar-narrow");
    await setContentSize(viewport.width, viewport.height);
    await waitFor("window.chatHistory.navigator().present", 10_000);
    return { screenshot: narrowScreenshot ?? wideScreenshot };
  });

  await scene("streaming-fast-thumb-drag-holds-position", async (measurement) => {
    await loadFresh(payload);
    await prepareBottom();
    const before = await startReply();
    assertScrollbar(before, "while a reply streams");
    const released = await dragThumbUp(THUMB_GESTURE_PX, { steps: 12, stepMs: 30 });
    const climbed = before.scrollTop - released.scrollTop;
    Object.assign(measurement, {
      clientHeight: released.clientHeight,
      screens: Number((climbed / released.clientHeight).toFixed(1)),
    });
    assert.ok(
      climbed >= released.clientHeight * 1.5,
      `the fast thumb drag carries the reader up the conversation (${Math.round(climbed)}px in ${released.clientHeight}px screens)`,
    );
    const screenshot = await capture("09-streaming-drag");
    await assertGestureHolds(measurement, released, "fast drag during a reply");
    const button = await scrollToBottomButton();
    await clickAt(centre(button).x, centre(button).y);
    await assertFollowsLatest(measurement, "fast drag during a reply");
    await endReply();
    return { screenshot };
  });

  await scene("streaming-held-then-slow-thumb-drag-holds-position", async (measurement) => {
    await loadFresh(payload);
    await prepareBottom();
    const before = await startReply();
    assertScrollbar(before, "while a reply streams");
    const released = await dragThumbUp(THUMB_GESTURE_PX, { steps: 20, stepMs: 60, holdMs: 1500 });
    const climbed = before.scrollTop - released.scrollTop;
    Object.assign(measurement, {
      clientHeight: released.clientHeight,
      screens: Number((climbed / released.clientHeight).toFixed(1)),
    });
    assert.ok(
      climbed >= released.clientHeight * 0.5,
      `holding the thumb and dragging it slowly carries the reader up the conversation (${Math.round(climbed)}px in ${released.clientHeight}px screens)`,
    );
    await assertGestureHolds(measurement, released, "held and slow drag during a reply");
    await scrollToBottomButton();
    await endReply();
    return {};
  });

  await scene("streaming-track-click-holds-position", async (measurement) => {
    await loadFresh(payload);
    await prepareBottom();
    const before = await startReply();
    assertScrollbar(before, "while a reply streams");
    const thumb = await thumbNow();
    const trackY = thumb.top + 40;
    const pressed = await js(`window.chatHistory.target(${Math.round(thumb.x)}, ${Math.round(trackY)})`);
    Object.assign(measurement, {
      pressed,
      thumbLength: Math.round(thumb.length),
      trackY: Math.round(trackY),
    });
    assert.ok(pressed?.isScroller, `the click lands on the scrollbar track itself (${JSON.stringify(pressed)})`);
    assert.ok(
      trackY + 20 < thumb.y - thumb.length / 2,
      `the click lands on the empty track above the thumb (track ${Math.round(trackY)}, thumb centre ${Math.round(thumb.y)})`,
    );
    await clickAt(thumb.x, trackY);
    await sleep(400);
    const released = await readState();
    const climbed = before.scrollTop - released.scrollTop;
    Object.assign(measurement, { screens: Number((climbed / released.clientHeight).toFixed(1)) });
    assert.ok(
      climbed >= released.clientHeight * 0.3 && climbed <= released.clientHeight * 1.5,
      `clicking the empty track pages the reader up about one screen (${Math.round(climbed)}px in ${released.clientHeight}px screens)`,
    );
    const screenshot = await capture("10-streaming-track-click");
    await assertGestureHolds(measurement, released, "track click during a reply", 15);
    await scrollToBottomButton();
    await endReply();
    return { screenshot };
  });

  await scene("streaming-press-in-message-text-keeps-following", async (measurement) => {
    await loadFresh(payload);
    await prepareBottom();
    const before = await startReply();
    assertScrollbar(before, "while a reply streams");
    const point = await js("window.chatHistory.prosePoint()");
    assert.ok(point, "the streaming reply shows text the reader can press on");
    const pressed = await js(`window.chatHistory.target(${Math.round(point.x)}, ${Math.round(point.y)})`);
    Object.assign(measurement, { pressed, text: point.text, textTop: point.top });
    assert.ok(
      pressed && pressed.inMessages && !pressed.isScroller,
      `the press lands in the message text, not on the scroller (${JSON.stringify(pressed)})`,
    );
    await press(point);
    const held = [];
    for (let step = 0; step < 8; step += 1) {
      await sleep(300);
      held.push((await readState()).distanceToLiveEnd);
    }
    await release(point);
    Object.assign(measurement, { heldDistances: held.map((value) => Math.round(value)) });
    assert.ok(
      Math.abs(held.at(-1)) <= FOLLOW_TOLERANCE_PX && Math.abs(held.at(-2)) <= FOLLOW_TOLERANCE_PX,
      `holding the mouse down in the message text without scrolling keeps the reply following (distance from the content end while still held: ${held.join(", ")})`,
    );
    await waitForFollowing("pressing in the message text");
    await assertFollowsLatest(measurement, "pressing in the message text");
    await endReply();
    return {};
  });

  await scene("streaming-press-and-release-thumb-keeps-following", async (measurement) => {
    await loadFresh(payload);
    await prepareBottom();
    const before = await startReply();
    assertScrollbar(before, "while a reply streams");
    const thumb = await thumbNow();
    const at = { x: thumb.x, y: thumb.y };
    const pressed = await js(`window.chatHistory.target(${Math.round(at.x)}, ${Math.round(at.y)})`);
    Object.assign(measurement, { pressed, thumbLength: Math.round(thumb.length) });
    assert.ok(pressed?.isScroller, `the press lands on the scrollbar itself (${JSON.stringify(pressed)})`);
    await press(at);
    const pressedState = await readState();
    await sleep(500);
    const beforeRelease = await readState();
    await release(at);
    Object.assign(measurement, {
      scrollWhileHeld: Math.round(beforeRelease.scrollTop - pressedState.scrollTop),
      distanceAtRelease: beforeRelease.distanceToLiveEnd,
    });
    await waitForFollowing("pressing the thumb and releasing it without dragging");
    await assertFollowsLatest(measurement, "pressing the thumb and releasing it without dragging");
    await endReply();
    return {};
  });

  await scene("idle-thumb-drag-to-top-shows-earlier-messages", async (measurement) => {
    await loadFresh(payload);
    await prepareBottom();
    const before = await readState();
    assertScrollbar(before, "while the reader is idle");
    const top = await dragThumbTo(0, { steps: 16, stepMs: 25 });
    assert.ok(top.scrollTop <= 1, `the thumb reaches the top of the loaded conversation (scrollTop ${top.scrollTop})`);
    await waitFor("window.chatHistory.state().pending > 0", 15_000);
    const pending = await readState();
    const earlier = await js("window.chatHistory.earlier()");
    const conversation = await js("window.chatHistory.conversation()");
    Object.assign(measurement, {
      earlier: earlier.text,
      earlierTop: earlier.rect ? Math.round(earlier.rect.top) : null,
      pageRequests: pending.requests,
    });
    assert.ok(earlier.present, "the top of the conversation offers the earlier messages control");
    assert.match(earlier.text, /earlier messages/i, `the control names the earlier messages ("${earlier.text}")`);
    assert.ok(
      earlier.rect && insideRect({ top: earlier.rect.top, bottom: earlier.rect.bottom }, conversation),
      `the earlier messages control is visible at the top of the conversation (top ${measurement.earlierTop})`,
    );
    const screenshot = await capture("11-earlier-messages");
    const sentence = await pickReadingSentence();
    const { settled } = await measureArrival(sentence, pending, measurement);
    assert.ok(measurement.delta <= lineHeight, `the sentence stays within one line (moved ${measurement.delta}px)`);
    Object.assign(measurement, { pageRequestsAfterArrival: settled.requests });
    return { screenshot };
  });

  async function settleScroll(label) {
    let previous = null;
    let stable = 0;
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const state = await readState();
      stable = previous !== null && Math.abs(state.scrollTop - previous) < 0.5 ? stable + 1 : 0;
      previous = state.scrollTop;
      if (stable >= 3) return state;
      await sleep(100);
    }
    throw new Error(`${label}: the conversation comes to rest before the next message (stuck at ${previous})`);
  }

  async function leaveBottomThenSend(path) {
    await loadFresh(payload);
    const point = await prepareBottom();
    const bottom = await readState();
    assertScrollbar(bottom, "while the reader leaves the bottom before sending");
    if (path === "wheel") {
      await wheelUp(point, 1200);
      await wheelUp(point, 1200);
    } else {
      await dragThumbUp(THUMB_GESTURE_PX, { steps: 10, stepMs: 25 });
    }
    const away = await settleScroll(path);
    const left = Math.round(bottom.scrollTop - away.scrollTop);
    assert.ok(
      left >= away.clientHeight,
      `the ${path} gesture leaves the bottom before the next message (moved ${left}px where one screen is ${away.clientHeight}px)`,
    );
    await sendMessage(SENT_MESSAGE);
    await startReply();
    await sleep(1200);
    const tops = [];
    for (let step = 0; step < 6; step += 1) {
      await sleep(200);
      tops.push(Math.round(await js(`window.chatHistory.messageTop(${JSON.stringify(SENT_MESSAGE)})`)));
    }
    const settled = await readState();
    await endReply();
    return {
      left,
      tops,
      prompts: settled.prompts,
      distanceToLiveEnd: settled.distanceToLiveEnd,
      scrollTop: Math.round(settled.scrollTop),
    };
  }

  await scene("idle-thumb-drag-then-send-matches-wheel", async (measurement) => {
    const wheel = await leaveBottomThenSend("wheel");
    const thumb = await leaveBottomThenSend("thumb");
    const screen = (await readState()).clientHeight;
    Object.assign(measurement, { wheel, thumb, screen });
    const drift = (tops) => Math.max(...tops) - Math.min(...tops);
    for (const [name, result] of [
      ["wheel", wheel],
      ["thumb", thumb],
    ]) {
      assert.ok(
        drift(result.tops) <= 20,
        `after the ${name} gesture the reply does not chase the sent message away from where sending put it (tops: ${result.tops.join(", ")})`,
      );
      assert.ok(
        result.distanceToLiveEnd > FOLLOW_TOLERANCE_PX,
        `after the ${name} gesture the reply leaves the reader where sending put them instead of dragging them to the latest content (${result.distanceToLiveEnd}px from the content end)`,
      );
    }
    const offsets = wheel.tops.map((top, index) => Math.abs(top - thumb.tops[index]));
    assert.ok(
      Math.max(...offsets) <= 8,
      `the thumb drag sends the next message into the same place as the wheel-up path (thumb ${thumb.tops.join(", ")} vs wheel ${wheel.tops.join(", ")})`,
    );
    assert.ok(
      Math.abs(wheel.distanceToLiveEnd - thumb.distanceToLiveEnd) <= FOLLOW_TOLERANCE_PX,
      `both gestures leave the reader equally far from the latest content (thumb ${thumb.distanceToLiveEnd}px, wheel ${wheel.distanceToLiveEnd}px, one screen is ${screen}px)`,
    );
    return {};
  });
}

function insideRect(inner, outer) {
  return inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1;
}
