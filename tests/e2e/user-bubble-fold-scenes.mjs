import assert from "node:assert/strict";
import {
  CHANNEL_PROMPT_MARKER,
  CHIP_PROMPT_MARKER,
  CHIP_PROMPT_PATH,
  FOLD_THRESHOLD_LINES,
  FOLDED_LINES,
  HANDOFF_PROMPT_MARKER,
  IMAGE_PROMPT_MARKER,
  LONG_PROMPT,
  LONG_PROMPT_LAST_LINE,
  LONG_PROMPT_LINES,
  LONG_PROMPT_MARKER,
  OFFSCREEN_PROMPT_MARKER,
  PICTURE_PROMPT_MARKER,
  PREVIEW_PROMPT_MARKER,
  WRAP_PROMPT_MARKER,
} from "../fixtures/long-prompt.mjs";
import {
  EN,
  NARROW_WIDTH,
  VIEWPORT,
  ZH,
  createFoldChecks,
  exactText,
  parseColor,
  quote,
} from "./user-bubble-fold-checks.mjs";

const previewsOf = (snapshot) => snapshot.images.filter((image) => !image.inRegion && !image.inChip);

export async function runFoldScenes(context) {
  const {
    js,
    page,
    waitFor,
    paint,
    sleep,
    capture,
    click,
    hover,
    key,
    scene,
    near,
    clipboard,
    setReducedMotion,
    setContentSize,
    consoleErrors,
  } = context;
  const { fold, foldPoint, foldedHeight, isFolded, isOpen, follows, waitUntil, show, assertFolded } =
    createFoldChecks(context);

  await scene("long-prompt-about-ten-lines-shows-in-full", async (measurement) => {
    await setContentSize(VIEWPORT.width, VIEWPORT.height);
    const snapshot = await show(WRAP_PROMPT_MARKER);
    Object.assign(measurement, {
      lines: snapshot.region.lines,
      height: Math.round(snapshot.region.rect.height),
      bubbleHeight: Math.round(snapshot.bubble.height),
    });
    assert.equal(snapshot.bar, null, "a prompt that fits shows no fold bar");
    assert.ok(
      snapshot.region.lines >= 8 && snapshot.region.lines <= FOLD_THRESHOLD_LINES,
      `a prompt of about ten rendered lines stays under the threshold (${snapshot.region.lines})`,
    );
    near(
      snapshot.region.rect.height,
      snapshot.region.lines * snapshot.region.lineHeight,
      "every line of the prompt is on screen",
      2,
    );
    assert.ok(
      snapshot.bubble.height - snapshot.region.rect.height <= 48,
      `the bubble reserves no room for a fold bar (${Math.round(snapshot.bubble.height - snapshot.region.rect.height)}px)`,
    );
    return { screenshot: await capture("12-wrap-prompt-in-full") };
  });

  await scene("long-prompt-folds-on-the-first-frame-it-appears", async (measurement) => {
    const frames = await page(`configure(${quote({ language: ZH, theme: "light", sample: LONG_PROMPT_MARKER })})`);
    assert.ok(Array.isArray(frames) && frames.length > 0, "the page reports the frames it draws");
    const first = frames.find((frame) => frame.exists && frame.lines > 0);
    assert.ok(first, "the long prompt reaches the screen");
    Object.assign(measurement, { firstFrame: first, frames: frames.slice(0, 8) });
    assert.equal(first.folded, true, "the first frame that draws the prompt already shows the fold bar");
    near(first.height, FOLDED_LINES * first.lineHeight, "the first frame already shows eight lines", 3);

    await waitFor("!document.body.textContent.includes('Loading session...')", "the session to load");
    await page(`scrollTo(${quote(LONG_PROMPT_MARKER)})`);
    await paint();
    const snapshot = await fold(LONG_PROMPT_MARKER);
    assertFolded(snapshot, "the folded prompt");
    assert.ok(snapshot.region.id, "the clipped text region carries an id for its toggle");
    assert.equal(snapshot.bar.buttons[0].controls, snapshot.region.id, "the toggle names the text it controls");
    assert.equal(snapshot.bar.label, "已收起", "the fold bar names the collapsed state");
    assert.equal(snapshot.bar.buttons[0].name, "展开全文", "the fold bar offers to show the whole prompt");
    assert.ok(snapshot.region.text.includes(LONG_PROMPT_LAST_LINE), "the hidden part of the prompt stays in the page");
    assert.ok(snapshot.bar.rect.top >= snapshot.region.rect.bottom - 1, "the fold bar sits under the text");
    assert.ok(
      snapshot.bar.rect.top - snapshot.region.rect.bottom <= 24,
      `the fold bar follows the text closely (${Math.round(snapshot.bar.rect.top - snapshot.region.rect.bottom)}px below it)`,
    );
    assert.ok(snapshot.bar.rect.left >= snapshot.bubble.left - 1, "the fold bar stays inside the bubble");
    return { screenshot: await capture("13-folded-prompt") };
  });

  await scene("long-prompt-opens-to-the-whole-text", async (measurement) => {
    const folded = await show(LONG_PROMPT_MARKER);
    assertFolded(folded, "the folded prompt");
    const point = await foldPoint(LONG_PROMPT_MARKER);
    assert.ok(point.hits, "the expand control is reachable with a pointer");
    await click(point);
    const opened = await waitUntil(LONG_PROMPT_MARKER, isOpen, "the prompt to open fully");
    Object.assign(measurement, {
      height: Math.round(opened.region.clientHeight),
      text: opened.region.scrollHeight,
      bar: opened.bar.text,
    });
    near(opened.region.clientHeight, opened.region.scrollHeight, "the opened prompt shows the whole text", 2);
    assert.equal(opened.bar.buttons.length, 1, "an opened prompt shows only the collapse control");
    assert.equal(opened.bar.buttons[0].expanded, "true", "the toggle reports the open state");
    assert.equal(opened.bar.buttons[0].name, "收起", "the open bar offers to fold the prompt again");
    assert.equal(opened.bar.label, "", "an open prompt shows no state label beside the control");
    assert.doesNotMatch(opened.bar.text, /[0-9]/, "the fold bar shows no character count");
    return { screenshot: await capture("14-opened-prompt") };
  });

  await scene("window-width-decides-the-fold-by-rendered-lines", async (measurement) => {
    await setContentSize(VIEWPORT.width, VIEWPORT.height);
    const wide = await show(WRAP_PROMPT_MARKER);
    const wrapsPastTheThreshold = (snapshot) => snapshot.region.lines > FOLD_THRESHOLD_LINES;
    const policy = (snapshot) => wrapsPastTheThreshold(snapshot) === Boolean(snapshot.bar);
    assert.ok(
      policy(wide),
      `at ${VIEWPORT.width}px the fold follows the rendered lines (${wide.region.lines} lines, fold bar ${Boolean(wide.bar)})`,
    );
    assert.ok(
      wide.region.lines <= FOLD_THRESHOLD_LINES,
      `the wide window renders the prompt in ${wide.region.lines} lines`,
    );
    assert.equal(wide.bar, null, "a prompt under the threshold gets no fold bar at the wide width");

    await setContentSize(NARROW_WIDTH, VIEWPORT.height);
    const narrow = await waitUntil(
      WRAP_PROMPT_MARKER,
      (snapshot) => snapshot.region.lines > FOLD_THRESHOLD_LINES,
      "the narrow window to wrap the prompt past the threshold",
    );
    Object.assign(measurement, {
      wideLines: wide.region.lines,
      narrowLines: narrow.region.lines,
      narrowHeight: Math.round(narrow.region.clientHeight),
    });
    assert.ok(
      policy(narrow),
      `at ${NARROW_WIDTH}px the fold follows the rendered lines (${narrow.region.lines} lines, fold bar ${Boolean(narrow.bar)})`,
    );
    assertFolded(narrow, "the prompt in the narrow window");

    await setContentSize(VIEWPORT.width, VIEWPORT.height);
    const widened = await waitUntil(
      WRAP_PROMPT_MARKER,
      (snapshot) => snapshot.region.lines <= FOLD_THRESHOLD_LINES,
      "the wide window to bring the prompt back under the threshold",
    );
    assert.ok(
      policy(widened),
      `at ${VIEWPORT.width}px the fold follows the rendered lines again (${widened.region.lines} lines, fold bar ${Boolean(widened.bar)})`,
    );
    assert.equal(widened.bar, null, "widening the window removes the fold bar again");
    near(
      widened.region.rect.height,
      widened.region.lines * widened.region.lineHeight,
      "the widened prompt is shown in full again",
      2,
    );
    return { screenshot: await capture("15-width-decides") };
  });

  await scene("chat-text-size-keeps-eight-lines-visible", async (measurement) => {
    await setContentSize(VIEWPORT.width, VIEWPORT.height);
    const observed = {};
    for (const fontSize of ["large", "extra-large"]) {
      const snapshot = await show(LONG_PROMPT_MARKER, { fontSize });
      assertFolded(snapshot, `the prompt at ${fontSize} text size`);
      observed[fontSize] = {
        lineHeight: snapshot.region.lineHeight,
        height: Math.round(snapshot.region.clientHeight),
      };
    }
    Object.assign(measurement, observed);
    assert.ok(
      observed["large"].lineHeight > 24,
      `the large text size has a taller line (${observed["large"].lineHeight}px)`,
    );
    assert.ok(
      observed["extra-large"].height > observed.large.height,
      `the folded prompt grows with the text size (${observed.large.height} → ${observed["extra-large"].height})`,
    );
    return { screenshot: await capture("16-extra-large-text") };
  });

  await scene("a-long-prompt-below-the-viewport-arrives-folded", async (measurement) => {
    await setContentSize(VIEWPORT.width, VIEWPORT.height);
    await show(OFFSCREEN_PROMPT_MARKER, { scroll: false });
    await page("scrollToBottom()");
    await paint();
    await sleep(250);
    const waiting = await fold(OFFSCREEN_PROMPT_MARKER);
    assert.ok(
      waiting.bubble.bottom <= waiting.conversation.rect.top,
      `the long prompt sat entirely above the viewport (its bottom is ${Math.round(waiting.bubble.bottom)}px, the viewport starts at ${Math.round(waiting.conversation.rect.top)}px)`,
    );
    const arrival = await page(`appearance(${quote(OFFSCREEN_PROMPT_MARKER)})`);
    Object.assign(measurement, {
      offscreen: arrival.offscreen,
      frames: arrival.frames,
      before: arrival.before,
      viewport: arrival.viewport,
      lines: arrival.region?.lines ?? null,
      height: arrival.region ? Math.round(arrival.region.clientHeight) : null,
      folded: Boolean(arrival.bar),
    });
    assert.equal(arrival.offscreen, true, "the long prompt was outside the viewport before it was reached");
    assert.ok(arrival.region, "the long prompt is laid out once it arrives");
    assert.ok(
      arrival.region.lines > FOLD_THRESHOLD_LINES,
      `the arriving prompt is past the threshold (${arrival.region.lines} lines)`,
    );
    assert.ok(arrival.bar, "the frame that brings the prompt on screen already shows its fold bar");
    near(arrival.region.clientHeight, foldedHeight(arrival), "the arriving prompt already shows eight lines", 2);
    return { screenshot: await capture("17-offscreen-arrival") };
  });

  await scene("folding-while-reading-the-end-keeps-the-top-on-screen", async (measurement) => {
    const folded = await show(LONG_PROMPT_MARKER);
    assertFolded(folded, "the folded prompt");
    await click(await foldPoint(LONG_PROMPT_MARKER));
    await waitUntil(LONG_PROMPT_MARKER, isOpen, "the prompt to open fully");
    await page(`bottomIntoView(${quote(LONG_PROMPT_MARKER)}, 40)`);
    await paint();
    const reading = await fold(LONG_PROMPT_MARKER);
    assert.ok(
      reading.bubbleTopInConversation < -200,
      `the reader is at the end of a prompt that starts above the viewport (${reading.bubbleTopInConversation}px)`,
    );
    const point = await foldPoint(LONG_PROMPT_MARKER);
    assert.ok(point.hits, "the collapse control is reachable while reading the end of the prompt");
    await click(point);
    const collapsed = await waitUntil(LONG_PROMPT_MARKER, isFolded, "the prompt to fold again");
    const textTop = Math.round(collapsed.region.rect.top - collapsed.conversation.rect.top);
    Object.assign(measurement, {
      beforeTop: reading.bubbleTopInConversation,
      afterTop: collapsed.bubbleTopInConversation,
      textTop,
      viewport: collapsed.conversation.clientHeight,
    });
    assert.ok(
      collapsed.bubble.top >= collapsed.conversation.rect.top - 1,
      `the folded prompt stays on screen (its top is ${collapsed.bubbleTopInConversation}px from the top of the viewport)`,
    );
    assert.ok(
      collapsed.bubbleTopInConversation <= 96,
      `the folded prompt comes back up to the top of the viewport (it is ${collapsed.bubbleTopInConversation}px from the top)`,
    );
    assert.ok(
      textTop >= 0 && textTop <= 110,
      `the beginning of the prompt is visible (its text starts ${textTop}px from the top of the viewport)`,
    );
    assert.ok(
      collapsed.bubble.bottom <= collapsed.conversation.rect.bottom + 1,
      "the folded prompt is fully inside the viewport",
    );
    return { screenshot: await capture("18-fold-keeps-the-top") };
  });

  await scene("opening-a-long-prompt-during-a-reply-stops-following", async (measurement) => {
    await page(`configure(${quote({ language: EN, theme: "light", session: "streaming" })})`);
    await waitFor("!document.body.textContent.includes('Loading session...')", "the streaming session to load");
    await waitFor(
      `!!window.userBubble.fold(${quote(LONG_PROMPT_MARKER)}).exists`,
      "the prompt of the streaming session",
    );
    const atRest = (snapshot) => Math.abs(snapshot.conversation.distanceToLiveEnd) <= 2;
    const replyParagraphsThatOutgrowTheWindow = 16;
    await page("startStream()");
    await page(`streamTick(${replyParagraphsThatOutgrowTheWindow})`);
    await follows("the reply to follow its own growth");
    await waitUntil(LONG_PROMPT_MARKER, atRest, "the view to come to rest at the newest content");

    const before = await fold(LONG_PROMPT_MARKER);
    const contentHeight = before.conversation.scrollHeight - before.conversation.spacerHeight;
    const windowHeight = before.conversation.clientHeight;
    Object.assign(measurement, { contentHeight, windowHeight });
    assert.ok(
      contentHeight > windowHeight,
      `the prompt and the reply together are taller than the window before the reader opens the prompt (${contentHeight} vs ${windowHeight}px)`,
    );
    const point = await foldPoint(LONG_PROMPT_MARKER);
    assert.ok(point.hits, "the expand control is reachable while the reply streams");
    await click(point);
    await page("streamTick(3)");
    await sleep(400);
    const after = await fold(LONG_PROMPT_MARKER);
    Object.assign(measurement, {
      beforeTop: before.bubbleTopInConversation,
      afterTop: after.bubbleTopInConversation,
      beforeDistance: before.conversation.distanceToLiveEnd,
      afterDistance: after.conversation.distanceToLiveEnd,
    });
    assert.equal(after.bar?.buttons?.[0]?.expanded, "true", "the prompt stays open after the reader opens it");
    assert.ok(
      Math.abs(after.bubbleTopInConversation - before.bubbleTopInConversation) <= 8,
      `the growing reply stops pulling the prompt away (${before.bubbleTopInConversation} → ${after.bubbleTopInConversation})`,
    );
    assert.equal(after.conversation.scrollToBottomButton, true, "the reader is offered the way back to the reply");

    const bottom = await page(`buttonPoint("Scroll to bottom")`);
    assert.ok(bottom?.hits, "the way back to the reply is reachable");
    await click(bottom);
    await follows("the reply to follow again after the reader returns");
    await page("streamTick(4)");
    const resumed = await follows("the reply to keep following after the reader returns");
    Object.assign(measurement, { resumedDistance: resumed.distanceToLiveEnd });
    await waitUntil(LONG_PROMPT_MARKER, atRest, "the view to come to rest after the reader returns");

    const collapse = await foldPoint(LONG_PROMPT_MARKER);
    assert.ok(collapse.hits, "the collapse control is reachable while the reply streams");
    await click(collapse);
    await sleep(400);
    const justFolded = await fold(LONG_PROMPT_MARKER);
    assert.equal(justFolded.bar?.buttons?.[0]?.expanded, "false", "folding during a reply folds the prompt");
    await page("streamTick(20)");
    await sleep(400);
    const heldFolded = await fold(LONG_PROMPT_MARKER);
    Object.assign(measurement, {
      foldedTop: justFolded.bubbleTopInConversation,
      heldTop: heldFolded.bubbleTopInConversation,
      foldedExpanded: heldFolded.bar?.buttons?.[0]?.expanded ?? null,
    });
    assert.equal(heldFolded.bar?.buttons?.[0]?.expanded, "false", "the folded prompt stays folded as the reply grows");
    assert.ok(
      heldFolded.conversation.scrollHeight > heldFolded.conversation.clientHeight + 200,
      `the growing reply is taller than the window, so following would move the prompt (${heldFolded.conversation.scrollHeight} vs ${heldFolded.conversation.clientHeight})`,
    );
    assert.ok(
      Math.abs(heldFolded.bubbleTopInConversation - justFolded.bubbleTopInConversation) <= 8,
      `folding stops the growing reply from pulling the prompt away (${justFolded.bubbleTopInConversation} → ${heldFolded.bubbleTopInConversation})`,
    );
    assert.equal(
      heldFolded.conversation.scrollToBottomButton,
      true,
      "the reader is offered the way back to the reply after folding",
    );
    const bottomAgain = await page(`buttonPoint("Scroll to bottom")`);
    assert.ok(bottomAgain?.hits, "the way back is reachable after folding");
    await click(bottomAgain);
    await follows("the reply to follow again after the reader folds the prompt");
    await page("endStream()");
    return { screenshot: await capture("19-streaming-expand") };
  });

  await scene("a-remounted-conversation-forgets-the-expanded-state", async (measurement) => {
    await setContentSize(VIEWPORT.width, VIEWPORT.height);
    const folded = await show(LONG_PROMPT_MARKER);
    assertFolded(folded, "the folded prompt");
    await click(await foldPoint(LONG_PROMPT_MARKER));
    const opened = await waitUntil(LONG_PROMPT_MARKER, isOpen, "the prompt to open fully");
    Object.assign(measurement, { openHeight: Math.round(opened.region.clientHeight) });
    assert.equal(opened.bar.buttons[0].expanded, "true", "the prompt is open before the conversation is left");
    const again = await show(LONG_PROMPT_MARKER);
    assertFolded(again, "the prompt after coming back");
    assert.equal(again.bar.buttons[0].expanded, "false", "coming back to the conversation forgets the open state");
    return { screenshot: await capture("20-remount-folded") };
  });

  await scene("images-and-previews-stay-outside-the-fold", async (measurement) => {
    await show(IMAGE_PROMPT_MARKER);
    await page(`topIntoView(${quote(IMAGE_PROMPT_MARKER)})`);
    await paint();
    const image = await fold(IMAGE_PROMPT_MARKER);
    assert.equal(image.bar, null, "a large image with two lines of text shows no fold bar");
    assert.equal(image.images.length, 1, "the prompt shows its image");
    const [picture] = image.images;
    assert.equal(picture.loaded, true, "the image has loaded");
    near(picture.visible.height, picture.rect.height, "the image is shown at its own height", 1);
    Object.assign(measurement, {
      image: { height: Math.round(picture.rect.height), text: image.region.lines },
    });
    assert.ok(picture.rect.height > 100, `the image is shown at its own size (${picture.rect.height}px)`);
    assert.ok(picture.rect.bottom <= image.region.rect.top + 1, "the image sits above the text");
    assert.ok(image.region.lines <= 3, `the text beside the image stays short (${image.region.lines} lines)`);

    await show(PICTURE_PROMPT_MARKER);
    await page(`topIntoView(${quote(PICTURE_PROMPT_MARKER)})`);
    await paint();
    const foldedPicture = await fold(PICTURE_PROMPT_MARKER);
    assertFolded(foldedPicture, "the long prompt with a picture on top");
    const [topPicture] = foldedPicture.images;
    Object.assign(measurement, {
      topPicture: { height: Math.round(topPicture.rect.height), visible: Math.round(topPicture.visible.height) },
    });
    assert.equal(topPicture.loaded, true, "the picture of the folded prompt has loaded");
    assert.equal(topPicture.inRegion, false, "the picture stays outside the clipped text");
    near(topPicture.visible.height, topPicture.rect.height, "no part of the folded prompt's picture is cut off", 1);
    assert.ok(topPicture.rect.bottom <= foldedPicture.region.rect.top + 1, "the picture sits above the folded text");

    await show(PREVIEW_PROMPT_MARKER);
    await waitUntil(
      PREVIEW_PROMPT_MARKER,
      (snapshot) => previewsOf(snapshot).some((element) => element.loaded),
      "the referenced image preview to load",
    );
    await page(`bottomIntoView(${quote(PREVIEW_PROMPT_MARKER)}, 60)`);
    await paint();
    const preview = await fold(PREVIEW_PROMPT_MARKER);
    assertFolded(preview, "the prompt with a referenced image");
    const previews = previewsOf(preview);
    const [referenced] = previews;
    Object.assign(measurement, {
      preview: {
        height: Math.round(referenced.rect.height),
        visible: Math.round(referenced.visible.height),
        chips: preview.images.filter((element) => element.inChip).length,
      },
      barBottom: Math.round(preview.bar.rect.bottom),
      textBottom: Math.round(preview.region.rect.bottom),
    });
    assert.equal(previews.length, 1, "the prompt shows one preview for the referenced image");
    assert.equal(referenced.inRegion, false, "the preview is not part of the clipped text");
    assert.equal(referenced.inChip, false, "the measured preview is not the attachment chip's own thumbnail");
    assert.equal(referenced.loaded, true, "the preview has loaded");
    near(referenced.visible.height, referenced.rect.height, "the fold cuts nothing off the preview", 1);
    assert.ok(preview.bar.rect.top >= preview.region.rect.bottom - 1, "the fold bar sits directly under the text");
    assert.ok(referenced.rect.top >= preview.bar.rect.bottom - 1, "the preview image comes below the fold bar");
    return { screenshot: await capture("21-image-outside-the-fold") };
  });

  await scene("tabbing-to-a-clipped-attachment-opens-the-prompt", async (measurement) => {
    const folded = await show(CHIP_PROMPT_MARKER);
    assertFolded(folded, "the folded prompt with a hidden attachment");
    const hiddenChip = await page(`chipRect(${quote(CHIP_PROMPT_MARKER)}, ${quote(CHIP_PROMPT_PATH)})`);
    assert.ok(hiddenChip, "the prompt carries the attachment chip");

    await page("blurActive()");
    let reached = false;
    for (let attempt = 0; attempt < 140 && !reached; attempt += 1) {
      await key("Tab");
      reached = (await page("focusedChipTitle()")) === CHIP_PROMPT_PATH;
    }
    assert.ok(reached, "Tab reaches the attachment the fold hides");

    const revealed = await waitUntil(
      CHIP_PROMPT_MARKER,
      (snapshot) => snapshot.bar?.buttons?.[0]?.expanded === "true",
      "the prompt to open for the focused attachment",
    );
    const chip = await page(`chipRect(${quote(CHIP_PROMPT_MARKER)}, ${quote(CHIP_PROMPT_PATH)})`);
    const viewport = revealed.conversation.rect;
    assert.ok(chip, "the attachment is still in the prompt");
    Object.assign(measurement, {
      chip: { top: Math.round(chip.top), bottom: Math.round(chip.bottom) },
      viewport: { top: Math.round(viewport.top), bottom: Math.round(viewport.bottom) },
      scrolled: revealed.scrolledInside,
    });
    assert.ok(chip.height > 0, "the attachment keeps its size");
    assert.ok(
      chip.top >= viewport.top - 1 && chip.bottom <= viewport.bottom + 1,
      "the focused attachment is on screen once the prompt opens",
    );
    assert.deepEqual(revealed.scrolledInside, [], "nothing inside the prompt scrolls away from its beginning");
    assert.ok(revealed.region.rect.top <= revealed.bubble.top + 24, "the opened prompt still starts at its beginning");
    return {};
  });

  await scene("keyboard-opens-and-folds-the-prompt", async (measurement) => {
    const folded = await show(LONG_PROMPT_MARKER);
    assertFolded(folded, "the folded prompt");
    const startedBeforeThePrompt = await page(`focusBefore(${quote(LONG_PROMPT_MARKER)})`);
    assert.equal(startedBeforeThePrompt, true, "the keyboard starts on the prompt before the long one");

    let reached = false;
    for (let attempt = 0; attempt < 12 && !reached; attempt += 1) {
      await key("Tab");
      reached = await page(`foldFocused(${quote(LONG_PROMPT_MARKER)})`);
    }
    assert.ok(reached, "Tab reaches the fold control");

    await key("Enter");
    const opened = await waitUntil(
      LONG_PROMPT_MARKER,
      (snapshot) => snapshot.bar?.buttons?.[0]?.expanded === "true",
      "Enter to open the prompt",
    );
    Object.assign(measurement, { afterEnter: opened.bar.buttons[0].expanded });
    assert.equal(opened.bar.buttons[0].expanded, "true", "Enter opens the prompt");
    assert.equal(
      await page(`foldFocused(${quote(LONG_PROMPT_MARKER)})`),
      true,
      "the keyboard stays on the fold control after opening",
    );

    await key("Space");
    const closed = await waitUntil(
      LONG_PROMPT_MARKER,
      (snapshot) => snapshot.bar?.buttons?.[0]?.expanded === "false",
      "Space to fold the prompt again",
    );
    Object.assign(measurement, { afterSpace: closed.bar.buttons[0].expanded });
    assert.equal(closed.bar.buttons[0].expanded, "false", "Space folds the prompt again");
    return { screenshot: await capture("22b-keyboard-fold") };
  });

  await scene("channel-and-handoff-prompts-fold-the-same-way", async (measurement) => {
    const channel = await show(CHANNEL_PROMPT_MARKER);
    assertFolded(channel, "the channel prompt");
    const colors = await page(`channelColors(${quote(CHANNEL_PROMPT_MARKER)})`);
    const expected = parseColor(colors.muted);
    const actual = parseColor(colors.label);
    Object.assign(measurement, { colors, source: channel.source });
    assert.equal(channel.source, "feishu", "the folded prompt sits on a coloured channel bubble");
    assert.ok(expected, "the channel bubble exposes the muted on-brand colour");
    assert.ok(actual, "the fold bar paints its label with a real colour");
    assert.ok(
      Math.abs(actual.r - expected.r) < 3 &&
        Math.abs(actual.g - expected.g) < 3 &&
        Math.abs(actual.b - expected.b) < 3 &&
        Math.abs(actual.a - expected.a) < 0.04,
      `the bar on a coloured bubble uses the muted on-brand colour (${colors.label} vs ${colors.muted})`,
    );
    await click(await foldPoint(CHANNEL_PROMPT_MARKER));
    const openedChannel = await waitUntil(CHANNEL_PROMPT_MARKER, isOpen, "the channel prompt to open fully");
    near(
      openedChannel.region.clientHeight,
      openedChannel.region.scrollHeight,
      "the channel prompt opens to the whole text",
      2,
    );

    const handoff = await show(HANDOFF_PROMPT_MARKER);
    assertFolded(handoff, "the prompt that came from another session");
    await click(await foldPoint(HANDOFF_PROMPT_MARKER));
    const openedHandoff = await waitUntil(HANDOFF_PROMPT_MARKER, isOpen, "the handoff prompt to open fully");
    assert.equal(openedHandoff.bar.buttons[0].expanded, "true", "the prompt from another session opens too");
    return { screenshot: await capture("22-channel-and-handoff") };
  });

  await scene("copying-and-editing-a-folded-prompt-keeps-the-whole-text", async (measurement) => {
    const folded = await show(LONG_PROMPT_MARKER);
    assertFolded(folded, "the folded prompt");
    await page(`bottomIntoView(${quote(LONG_PROMPT_MARKER)}, 90)`);
    await paint();

    const firstCopy = await page(`rowButtonPoint(${quote(LONG_PROMPT_MARKER)}, "复制消息")`);
    await hover(firstCopy);
    const copy = await page(`rowButtonPoint(${quote(LONG_PROMPT_MARKER)}, "复制消息")`);
    assert.ok(copy?.hits, "the copy control is reachable on a folded prompt");
    clipboard.writeText("");
    await click(copy);
    let copied = "";
    for (let attempt = 0; attempt < 20 && copied === ""; attempt += 1) {
      await sleep(100);
      copied = clipboard.readText();
    }
    Object.assign(measurement, { copiedLength: copied.length, copiedLines: copied.split("\n").length });
    assert.equal(
      exactText(copied),
      exactText(LONG_PROMPT),
      "copying a folded prompt copies the whole original text, line breaks and all",
    );
    assert.equal(copied.split("\n").length, LONG_PROMPT_LINES, "the copy keeps every line break of the prompt");

    const firstEdit = await page(`rowButtonPoint(${quote(LONG_PROMPT_MARKER)}, "从这里编辑")`);
    await hover(firstEdit);
    const edit = await page(`rowButtonPoint(${quote(LONG_PROMPT_MARKER)}, "从这里编辑")`);
    assert.ok(edit?.hits, "the edit control is reachable on a folded prompt");
    await click(edit);
    let editor = null;
    for (let attempt = 0; attempt < 200 && editor === null; attempt += 1) {
      editor = await page(`editorText(${quote(LONG_PROMPT_MARKER)})`);
      if (editor === null) await sleep(40);
    }
    assert.ok(editor !== null, "clicking edit opens the message in an editor");
    Object.assign(measurement, { editorLength: editor.length, editorLines: editor.split("\n").length });
    assert.equal(
      exactText(editor),
      exactText(LONG_PROMPT),
      "editing a folded prompt starts from the whole text, line breaks and all",
    );
    assert.equal(editor.split("\n").length, LONG_PROMPT_LINES, "the editor keeps every line break of the prompt");
    return {};
  });

  await scene("reduced-motion-switches-the-fold-at-once", async (measurement) => {
    await setReducedMotion(true);
    try {
      const folded = await show(LONG_PROMPT_MARKER);
      assertFolded(folded, "the folded prompt");
      assert.equal(
        await js(`window.matchMedia("(prefers-reduced-motion: reduce)").matches`),
        true,
        "the scene runs with reduced motion switched on",
      );
      await click(await foldPoint(LONG_PROMPT_MARKER));
      const opened = await fold(LONG_PROMPT_MARKER);
      Object.assign(measurement, {
        heightAfterClick: Math.round(opened.region.clientHeight),
        text: opened.region.scrollHeight,
      });
      near(
        opened.region.clientHeight,
        opened.region.scrollHeight,
        "the prompt is already fully open on the next frame, with no animation",
        2,
      );
      await page(`bottomIntoView(${quote(LONG_PROMPT_MARKER)}, 60)`);
      await paint();
      const collapse = await foldPoint(LONG_PROMPT_MARKER);
      assert.ok(collapse.hits, "the collapse control is on screen with reduced motion on");
      await click(collapse);
      const closed = await fold(LONG_PROMPT_MARKER);
      Object.assign(measurement, {
        heightAfterSecondClick: Math.round(closed.region.clientHeight),
        folded: Math.round(foldedHeight(closed)),
        expanded: closed.bar?.buttons?.[0]?.expanded ?? null,
      });
      near(
        closed.region.clientHeight,
        foldedHeight(closed),
        "the prompt is already folded on the next frame, with no animation",
        2,
      );
      assert.equal(closed.bar?.buttons?.[0]?.expanded, "false", "the reader can fold the prompt again at once");
    } finally {
      await setReducedMotion(false);
    }
    return { screenshot: await capture("23-reduced-motion") };
  });

  await scene("resizing-a-long-prompt-reports-no-observer-errors", async (measurement) => {
    await setContentSize(VIEWPORT.width, VIEWPORT.height);
    const folded = await show(LONG_PROMPT_MARKER);
    assertFolded(folded, "the folded prompt");
    await click(await foldPoint(LONG_PROMPT_MARKER));
    await waitUntil(LONG_PROMPT_MARKER, isOpen, "the prompt to open fully");
    await setContentSize(1100, VIEWPORT.height);
    await setContentSize(700, VIEWPORT.height);
    await setContentSize(VIEWPORT.width, VIEWPORT.height);
    await show(PREVIEW_PROMPT_MARKER);
    await sleep(400);
    const observerErrors = consoleErrors().filter((message) => /ResizeObserver loop/i.test(message));
    Object.assign(measurement, { errors: consoleErrors().length, observerErrors });
    assert.deepEqual(observerErrors, [], "opening and resizing long prompts raises no ResizeObserver loop error");
    return { screenshot: await capture("24-resize") };
  });

  await scene("the-fold-bar-speaks-the-app-language", async (measurement) => {
    const chinese = await show(LONG_PROMPT_MARKER, { language: ZH });
    assertFolded(chinese, "the folded prompt in Chinese");
    assert.equal(chinese.bar.label, "已收起", "the collapsed prompt is named in Chinese");
    assert.equal(chinese.bar.buttons[0].name, "展开全文", "the Chinese bar offers the whole prompt");
    const english = await show(LONG_PROMPT_MARKER, { language: EN });
    assertFolded(english, "the folded prompt in English");
    Object.assign(measurement, {
      chinese: { label: chinese.bar.label, toggle: chinese.bar.buttons[0].name },
      english: { label: english.bar.label, toggle: english.bar.buttons[0].name },
    });
    assert.ok(english.bar.label.length > 0, "the collapsed prompt is named in English too");
    assert.notEqual(english.bar.label, chinese.bar.label, "the English label is its own wording, not the Chinese one");
    assert.ok(
      english.bar.buttons[0].name.length > 0 && english.bar.buttons[0].name !== chinese.bar.buttons[0].name,
      "the English control is named in English too",
    );
    return { screenshot: await capture("25-english-fold") };
  });

  const failed = [];
  for (const record of context.records()) if (record.pass !== true) failed.push(record.name);
  assert.deepEqual(failed, [], `long prompt scenes that failed: ${failed.join(", ")}`);
}
