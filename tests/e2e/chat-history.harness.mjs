import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";
import { configureSmokeEnvironment } from "../../src/smoke/environment.ts";
import { createScrollbarTools } from "./chat-history-scrollbar.mjs";
import { runScrollbarScenes } from "./chat-history-scrollbar-scenes.mjs";
import { QUESTION_COUNT, buildHistory, turnName } from "./chat-history-session.mjs";

configureSmokeEnvironment();
const output = process.env.DEXON_RENDERER_OUT;
if (!output) throw new Error("Chat history reading requires an evidence directory");
const directory = path.dirname(fileURLToPath(import.meta.url));
const VIEWPORT = { width: 1440, height: 900 };
const LINE_HEIGHT = 24;

const records = [];
const failures = [];
const consoleErrors = [];
let window;
const js = (source) => window.webContents.executeJavaScript(source, true);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const watchdog = setTimeout(() => app.exit(1), 570_000);

async function waitFor(condition, timeoutMs = 20_000) {
  await js(`new Promise((resolve,reject)=>{const deadline=Date.now()+${timeoutMs};function check(){
    if(${condition})resolve();else if(Date.now()>deadline)reject(new Error('Unmet page condition: '+${JSON.stringify(condition)}));else setTimeout(check,25);
  }check();})`);
}

async function paint() {
  await js(
    "document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))",
  );
}

async function capture(name) {
  await paint();
  const image = await window.webContents.capturePage();
  fs.writeFileSync(path.join(output, `${name}.png`), image.toPNG());
  fs.writeFileSync(path.join(output, `${name}-small.png`), image.resize({ width: 640 }).toPNG());
  return `${name}.png`;
}

async function hover(x, y) {
  window.webContents.sendInputEvent({ type: "mouseMove", x: Math.round(x), y: Math.round(y) });
  await sleep(30);
}

async function clickAt(x, y) {
  window.webContents.sendInputEvent({ type: "mouseMove", x: Math.round(x), y: Math.round(y) });
  window.webContents.sendInputEvent({
    type: "mouseDown",
    x: Math.round(x),
    y: Math.round(y),
    button: "left",
    clickCount: 1,
  });
  window.webContents.sendInputEvent({
    type: "mouseUp",
    x: Math.round(x),
    y: Math.round(y),
    button: "left",
    clickCount: 1,
  });
  await sleep(50);
}

// Electron reports the platform wheel delta, which is inverted against the DOM
// on macOS. Calibrate the direction once at the bottom instead of assuming one.
let upDelta = null;

async function sendWheel(point, deltaY) {
  window.webContents.sendInputEvent({
    type: "mouseWheel",
    x: Math.round(point.x),
    y: Math.round(point.y),
    deltaX: 0,
    deltaY,
    canScroll: true,
  });
  await sleep(30);
}

async function wheelUp(point, amount = 1200) {
  await sendWheel(point, Math.sign(upDelta) * amount);
}

async function wheelDown(point, amount = 1200) {
  await sendWheel(point, -Math.sign(upDelta) * amount);
}

async function pressKey(keyCode) {
  window.webContents.sendInputEvent({ type: "keyDown", keyCode });
  window.webContents.sendInputEvent({ type: "keyUp", keyCode });
  await sleep(30);
}

function centre(rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

const scrollTop = async () => (await js("window.chatHistory.state()")).scrollTop;

const tools = createScrollbarTools({
  js,
  sendInputEvent: (event) => window.webContents.sendInputEvent(event),
  waitFor,
});

const { readState, assertScrollbar, dragThumbTo } = tools;

async function setContentSize(width, height) {
  window.setContentSize(width, height);
  await sleep(200);
}

async function pressEnter() {
  window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
  window.webContents.sendInputEvent({ type: "char", keyCode: "\r" });
  window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
  await sleep(30);
}

async function scrollToBottom() {
  await js("window.chatHistory.scrollToBottom()");
  await waitFor("window.chatHistory.state().atBottom", 10_000);
  await sleep(200);
}

async function calibrateWheelDirection(point) {
  if (upDelta !== null) return;
  const before = await scrollTop();
  await sendWheel(point, 600);
  await sleep(250);
  upDelta = (await scrollTop()) < before ? 600 : -600;
  await scrollToBottom();
}

async function conversationCentre() {
  const rect = await js("window.chatHistory.conversation()");
  assert.ok(rect, "the conversation is on screen");
  return centre(rect);
}

async function prepareBottom() {
  await scrollToBottom();
  const point = await conversationCentre();
  window.webContents.focus();
  await hover(point.x, point.y);
  await calibrateWheelDirection(point);
  return point;
}

async function wheelUntilPagePending(point) {
  for (let step = 0; step < 240; step += 1) {
    const state = await js("window.chatHistory.state()");
    if (state.pending > 0) return state;
    await wheelUp(point);
  }
  throw new Error("no older page was requested while the reader kept scrolling up");
}

async function keyUntilPagePending(point) {
  await clickAt(point.x, point.y);
  const startedAt = await scrollTop();
  for (let step = 0; step < 240; step += 1) {
    const state = await js("window.chatHistory.state()");
    if (state.pending > 0) return state;
    if (step === 3 && state.scrollTop >= startedAt) throw new Error("PageUp does not scroll the conversation");
    await pressKey("PageUp");
  }
  throw new Error("no older page was requested while the reader kept pressing PageUp");
}

let loaded = false;

async function loadFresh(payload) {
  if (loaded) await js("window.chatHistory.reload()");
  else {
    await js(`window.chatHistory.load(${payload})`);
    loaded = true;
  }
  await waitFor("window.chatHistory.state().ready", 30_000);
  await paint();
}

async function scene(name, story) {
  const measurement = {};
  try {
    const result = await story(measurement);
    records.push({ name, measurement, screenshot: result?.screenshot, pass: true });
    console.log(`[chat-history] ${name}: pass ${JSON.stringify(measurement)}`);
  } catch (error) {
    failures.push({ scene: name, error: error.stack ?? String(error) });
    records.push({ name, measurement, pass: false, error: String(error?.message ?? error) });
    console.error(`[chat-history] ${name}: FAIL ${error?.message ?? error} ${JSON.stringify(measurement)}`);
    if (window && !window.isDestroyed()) await capture(`failure-${name}`).catch(() => {});
  }
}

async function dragUp(amount = 900) {
  const state = await readState();
  await dragThumbTo(state.scrollTop - amount, { steps: 6, stepMs: 20 });
  await sleep(40);
}

async function dragUntilPagePending() {
  for (let step = 0; step < 400; step += 1) {
    const state = await js("window.chatHistory.state()");
    if (state.pending > 0) return state;
    await dragUp();
  }
  throw new Error("no older page was requested while the reader dragged the scrollbar up");
}

async function moveUp(point, mode) {
  if (mode === "key") await pressKey("PageUp");
  else if (mode === "drag") await dragUp();
  else await wheelUp(point);
}

async function reachTop(point, mode) {
  for (let step = 0; step < 120; step += 1) {
    if ((await scrollTop()) <= 1) return;
    await moveUp(point, mode);
  }
  throw new Error("the reader never reached the top of the loaded window");
}

// The reader's place is a sentence of the transcript. Reply paragraphs are
// stable-height prose, so the same sentence can be measured before and after
// the page arrives without process groups opening or closing underneath it.
async function pickReadingSentence() {
  const sentences = await js("window.chatHistory.sentencesBetween(40, 700)");
  const replies = sentences.filter((sentence) => sentence.text.startsWith("Answer "));
  const pool = replies.length > 0 ? replies : sentences.filter((s) => s.top >= 300 && s.top <= 400);
  assert.ok(pool.length > 0, "a sentence is readable below the conversation top");
  return pool.reduce((best, candidate) =>
    Math.abs(candidate.top - 350) < Math.abs(best.top - 350) ? candidate : best,
  );
}

async function readSentenceNear(point, mode) {
  if (mode === "key") await keyUntilPagePending(point);
  else if (mode === "drag") await dragUntilPagePending();
  else await wheelUntilPagePending(point);
  await reachTop(point, mode);
  return pickReadingSentence();
}

async function measureArrival(sentence, before, measurement) {
  await js("window.chatHistory.release()");
  await waitFor(`window.chatHistory.state().transcript > ${before.transcript}`, 20_000);
  await paint();
  await paint();
  await sleep(500);
  const after = await js(`window.chatHistory.positionOf(${JSON.stringify(sentence.text)})`);
  assert.ok(after !== null, "the sentence the reader was looking at is still on the page");
  await sleep(1500);
  const settled = await js("window.chatHistory.state()");
  Object.assign(measurement, {
    sentence: sentence.text,
    before: Math.round(sentence.top),
    after: Math.round(after),
    delta: Math.round(Math.abs(after - sentence.top)),
  });
  return { after, settled };
}

const QUESTION_PREFIX = (number) => `Question ${String(number).padStart(2, "0")}:`;

function insideRect(inner, outer) {
  return inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1;
}

async function expandNavigator() {
  const navigator = await js("window.chatHistory.navigator()");
  assert.ok(navigator.present, "the conversation shows its navigator");
  const point = centre(navigator.rect);
  await hover(point.x, point.y);
  await sleep(400);
  return js("window.chatHistory.navigator()");
}

// Bring a turn of the expanded list into view the way a reader does, by
// wheeling the list, then click it and keep answering every page it asks for.
async function jumpTo(index) {
  for (let step = 0; step < 200; step += 1) {
    const navigator = await js("window.chatHistory.navigator()");
    const target = navigator.buttons[index];
    assert.ok(target, `the navigator offers turn ${index + 1}`);
    if (insideRect(target.rect, navigator.rect)) {
      const at = centre(target.rect);
      await js("window.chatHistory.autoRelease(true)");
      while ((await js("window.chatHistory.state()")).pending > 0) await js("window.chatHistory.release()");
      await clickAt(at.x, at.y);
      return;
    }
    const point = centre(navigator.rect);
    if (target.rect.top < navigator.rect.top) await wheelUp(point, 120);
    else await wheelDown(point, 120);
    await sleep(60);
  }
  throw new Error(`turn ${index + 1} never scrolled into the navigator`);
}

async function settledMessageTop(prefix) {
  await waitFor(`window.chatHistory.messageTop(${JSON.stringify(prefix)}) !== null`, 60_000);
  let previous = null;
  let equal = 0;
  for (let step = 0; step < 200; step += 1) {
    await paint();
    await sleep(70);
    const top = await js(`window.chatHistory.messageTop(${JSON.stringify(prefix)})`);
    equal = previous !== null && Math.abs(top - previous) < 0.5 ? equal + 1 : 0;
    previous = top;
    if (equal >= 2 && (await js("window.chatHistory.state()")).pending === 0) {
      await js("window.chatHistory.autoRelease(false)");
      return top;
    }
  }
  await js("window.chatHistory.autoRelease(false)");
  throw new Error(`${prefix} never settled in one place`);
}

async function run(payload) {
  await app.whenReady();
  window = new BrowserWindow({
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    show: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.session.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: /^https?:/.test(details.url) }),
  );
  window.webContents.on("console-message", (event) => {
    if (event.level === "error") consoleErrors.push(event.message);
  });
  await window.loadFile(path.join(directory, "index.html"));
  window.focus();
  window.webContents.focus();
  await waitFor("document.hasFocus()");

  await scene("outline-complete", async (measurement) => {
    await loadFresh(payload);
    await waitFor("window.chatHistory.navigator().buttons.length > 0", 30_000);
    const rect = await js("window.chatHistory.navigator()");
    const navCentre = centre(rect.rect);
    await hover(navCentre.x, navCentre.y);
    await sleep(200);
    const navigator = await js("window.chatHistory.navigator()");
    const names = navigator.buttons.map((button) => button.name);
    Object.assign(measurement, {
      turns: names.length,
      collapsed: rect.own,
      first: names[0],
      last: names[names.length - 1],
      pageRequests: (await js("window.chatHistory.state()")).requests,
    });
    const screenshot = await capture("01-outline-complete");
    assert.equal(names.length, QUESTION_COUNT, "the navigator lists every question of the conversation");
    assert.deepEqual(
      names,
      Array.from({ length: QUESTION_COUNT }, (_value, index) => turnName(index)),
      "the navigator lists the questions in conversation order, each named by its question",
    );
    return { screenshot };
  });

  for (const [name, mode] of [
    ["wheel-reading-keeps-position", "wheel"],
    ["pageup-reading-keeps-position", "key"],
    ["scrollbar-drag-reading-keeps-position", "drag"],
  ]) {
    await scene(name, async (measurement) => {
      await loadFresh(payload);
      const point = await prepareBottom();
      if (mode === "drag") assertScrollbar(await readState(), "while the reader drags its thumb");
      const sentence = await readSentenceNear(point, mode);
      const before = await js("window.chatHistory.state()");
      const { settled } = await measureArrival(sentence, before, measurement);
      Object.assign(measurement, { pageRequests: settled.requests });
      assert.ok(measurement.delta <= LINE_HEIGHT, `the sentence stays within one line (moved ${measurement.delta}px)`);
      assert.equal(settled.requests, 1, "reading onwards asks for exactly one page while idle");
      if (mode === "drag") return {};
      if (mode === "key") await keyUntilPagePending(point);
      else await wheelUntilPagePending(point);
      const next = await js("window.chatHistory.state()");
      Object.assign(measurement, { pageRequestsAfterReadingOn: next.requests });
      assert.equal(next.requests, 2, "reading on brings the next page");
      return {};
    });
  }

  await scene("jump-to-unloaded-question", async (measurement) => {
    await loadFresh(payload);
    await prepareBottom();
    const expanded = await expandNavigator();
    Object.assign(measurement, { turns: expanded.buttons.length });
    assert.equal(expanded.buttons.length, QUESTION_COUNT, "the navigator lists the whole conversation before the jump");
    assert.equal(expanded.buttons[2].name, turnName(2), "the third turn is the third question of the conversation");
    const beforeScreenshot = await capture("02-before-jump");
    await jumpTo(2);
    const top = await settledMessageTop(QUESTION_PREFIX(3));
    const state = await js("window.chatHistory.state()");
    Object.assign(measurement, { target: turnName(2), top: Math.round(top), pageRequests: state.requests });
    const afterScreenshot = await capture("03-after-jump");
    assert.ok(Math.abs(top - 16) <= 1, `the chosen question sits 16px below the top (measured ${top}px)`);

    const point = await conversationCentre();
    for (let step = 0; step < 400; step += 1) {
      if ((await js("window.chatHistory.state()")).atBottom) break;
      await wheelDown(point, 1500);
    }
    const prefixes = Array.from({ length: QUESTION_COUNT - 2 }, (_value, index) => QUESTION_PREFIX(index + 3));
    const order = await js(`window.chatHistory.order(${JSON.stringify(prefixes)})`);
    const missing = order.filter((entry) => entry.count !== 1).map((entry) => entry.prefix);
    const gaps = order.filter((entry, index) => index > 0 && entry.index < order[index - 1].index).map((e) => e.prefix);
    const reachedBottom = (await js("window.chatHistory.state()")).atBottom;
    Object.assign(measurement, {
      questionsRead: order.length,
      missing,
      gaps,
      reachedBottom,
      screenshots: [beforeScreenshot, afterScreenshot],
    });
    assert.equal(missing.length, 0, `every question after the jump reads once (not once: ${missing.join(", ")})`);
    assert.equal(gaps.length, 0, `the transcript reads in order (out of order: ${gaps.join(", ")})`);
    assert.ok(reachedBottom, "reading down from the jump reaches the bottom");
    return { screenshot: afterScreenshot };
  });

  await scene("navigator-follows-current", async (measurement) => {
    await loadFresh(payload);
    const point = await prepareBottom();
    const bottom = await js("window.chatHistory.navigator()");
    Object.assign(measurement, { turns: bottom.buttons.length, collapsed: bottom.own });
    assert.equal(bottom.buttons.length, QUESTION_COUNT, "the navigator lists the whole conversation");
    assert.ok(
      bottom.own.scrollHeight > bottom.own.clientHeight,
      `the collapsed ticks overflow the navigator (${bottom.own.scrollHeight} > ${bottom.own.clientHeight})`,
    );
    const last = bottom.buttons.at(-1);
    Object.assign(measurement, { currentAtBottom: bottom.buttons.find((button) => button.current)?.name ?? null });
    assert.ok(last.current, "the last question is highlighted at the bottom of the conversation");
    assert.ok(insideRect(last.rect, bottom.rect), "the last question's tick is fully visible in the navigator");

    await expandNavigator();
    await jumpTo(29);
    await settledMessageTop(QUESTION_PREFIX(30));
    await hover(point.x - 300, point.y);
    await sleep(400);
    const middle = await js("window.chatHistory.navigator()");
    const current = middle.buttons.find((button) => button.current);
    assert.ok(current, "the navigator marks a current turn after the jump");
    const index = middle.buttons.indexOf(current);
    const rowCentre = current.rect.top + current.rect.height / 2;
    const third = middle.rect.height / 3;
    Object.assign(measurement, {
      currentAfterJump: current.name,
      rowCentre: Math.round(rowCentre),
      middleThird: [Math.round(middle.rect.top + third), Math.round(middle.rect.bottom - third)],
    });
    assert.ok(Math.abs(index - 29) <= 1, `the current turn is turn 30 or next to it (${current.name})`);
    assert.ok(insideRect(current.rect, middle.rect), "the current row is fully inside the navigator");
    assert.ok(
      rowCentre >= middle.rect.top + third && rowCentre <= middle.rect.bottom - third,
      "the current row sits in the middle third of the navigator",
    );

    const navPoint = centre(middle.rect);
    await hover(navPoint.x, navPoint.y);
    await sleep(400);
    const expanded = await js("window.chatHistory.navigator()");
    const currentExpanded = expanded.buttons.find((button) => button.current);
    assert.ok(currentExpanded, "the expanded list still marks the current turn");
    assert.ok(insideRect(currentExpanded.rect, expanded.rect), "the expanded list opens at the current row");
    const listBefore = expanded.scroller.scrollTop;
    await wheelUp(centre(expanded.rect), 240);
    await sleep(400);
    const scrolled = await js("window.chatHistory.navigator()");
    const listAfter = scrolled.scroller.scrollTop;
    await sleep(400);
    const settledList = await js("window.chatHistory.navigator()");
    Object.assign(measurement, {
      listScrollBefore: listBefore,
      listScrollAfter: listAfter,
      listScrollSettled: settledList.scroller.scrollTop,
    });
    const screenshot = await capture("04-navigator-expanded");
    assert.notEqual(listAfter, listBefore, "wheeling over the expanded list scrolls it");
    assert.equal(settledList.scroller.scrollTop, listAfter, "the list does not snap back while the reader browses it");
    return { screenshot };
  });

  await scene("existing-behaviour", async (measurement) => {
    await loadFresh(payload);
    const point = await prepareBottom();
    await reachTop(point, "wheel");
    await waitFor("window.chatHistory.button('Scroll to bottom') !== null", 10_000);
    const button = await js("window.chatHistory.button('Scroll to bottom')");
    assert.ok(button, "the scroll-to-bottom button appears once the reader leaves the bottom");
    const at = centre(button);
    await clickAt(at.x, at.y);
    await sleep(1500);
    const bottomState = await js("window.chatHistory.state()");
    const distance = Math.round(bottomState.scrollHeight - bottomState.clientHeight - bottomState.scrollTop);
    Object.assign(measurement, { distanceToBottom: distance });
    const scrolledScreenshot = await capture("05-scroll-to-bottom");
    assert.ok(distance <= 2, `the button returns to the bottom (${distance}px away)`);

    window.setContentSize(640, VIEWPORT.height);
    await waitFor("!window.chatHistory.navigator().present", 10_000);
    const narrow = await js("window.chatHistory.state()");
    const screenshot = await capture("06-narrow");
    Object.assign(measurement, { narrowNavigator: narrow.navigator });
    assert.equal(narrow.navigator, false, "a narrow window hides the navigator");
    window.setContentSize(VIEWPORT.width, VIEWPORT.height);
    await waitFor("window.chatHistory.navigator().present", 10_000);
    return { screenshot: screenshot ?? scrolledScreenshot };
  });

  await runScrollbarScenes({
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
    insertText: (text) => window.webContents.insertText(text),
    pressEnter,
    setContentSize,
    viewport: VIEWPORT,
    pickReadingSentence,
    measureArrival,
    lineHeight: LINE_HEIGHT,
    tools,
  });
}

async function main() {
  let code = 0;
  const history = buildHistory();
  try {
    assert.ok(
      history.pageFirstRoles.some((role) => role !== null && role !== "user"),
      "at least one page boundary splits a turn, the real-world condition of the bug",
    );
    assert.ok(history.bytes > 4 * 1024 * 1024, `the conversation is larger than 4MB (${history.bytes} bytes)`);
    await run(JSON.stringify(history.payload));
    if (records.some((entry) => !entry.pass)) code = 1;
  } catch (error) {
    code = 1;
    failures.push({ scene: "harness", error: error.stack ?? String(error) });
    console.error(error);
    if (window && !window.isDestroyed()) await capture("failure").catch(() => {});
  } finally {
    if (window && !window.isDestroyed()) {
      try {
        await js("window.chatHistory?.close()");
      } catch (error) {
        code = 1;
        failures.push({ scene: "teardown", error: String(error) });
      }
      window.destroy();
    }
    fs.writeFileSync(
      process.env.DEXON_ELECTRON_RESULT,
      JSON.stringify(
        {
          completed: code === 0,
          pid: process.pid,
          pass: code === 0,
          records,
          failures,
          consoleErrors,
          capturedAt: new Date().toISOString(),
          history: {
            questions: QUESTION_COUNT,
            entries: history.entries,
            bytes: history.bytes,
            olderPages: history.olderPages,
            pageFirstRoles: history.pageFirstRoles,
          },
          environment: {
            platform: process.platform,
            arch: process.arch,
            electron: process.versions.electron,
            chromium: process.versions.chrome,
          },
        },
        null,
        2,
      ),
    );
    clearTimeout(watchdog);
    app.exit(code);
  }
}

void main();
