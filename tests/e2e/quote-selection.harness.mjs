import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";
import { configureSmokeEnvironment } from "../../src/smoke/environment.ts";
import { createSessionDetail } from "../../src/renderer/hooks/agent-session/session-hook-fixtures.mjs";
import { encodeComposerQuoteToken, serializeComposerQuotesForSend } from "../../src/shared/quote-tokens.ts";

configureSmokeEnvironment();
const output = process.env.DEXON_RENDERER_OUT;
if (!output) throw new Error("Selection quote requires an evidence directory");
const directory = path.dirname(fileURLToPath(import.meta.url));
const records = [];
const failures = [];
let window;
const watchdog = setTimeout(() => app.exit(1), 85_000);

const ASSISTANT_ENTRY = "assistant-target";
const USER_ENTRY = "user-target";
const SENT_USER_ENTRY = "sent-user-quote";
const ASSISTANT_TEXT = "The answer includes **bold alpha** and `inline-code beta` for selection.";
const SELECTION_TEXT = "bold alpha and inline-code beta";
const OLDER_TEXT = "An older assistant reply contains the historical target text.";
const DETACHED_TEXT = "This full detached quote keeps every verbatim character.";

const assistantQuote = {
  id: "1",
  text: SELECTION_TEXT,
  from: "assistant",
  entryId: ASSISTANT_ENTRY,
  prefix: "The answer includes ",
  suffix: " for selection.",
};
const userQuote = {
  id: "1",
  text: "The user's earlier request is still available.",
  from: "user",
  entryId: USER_ENTRY,
  prefix: "Before the reply, ",
  suffix: " Then the assistant answered.",
};
const olderQuote = {
  id: "1",
  text: OLDER_TEXT,
  from: "assistant",
  entryId: "older-assistant-entry",
  prefix: "An older assistant reply contains ",
  suffix: ".",
};
const detachedQuote = {
  id: "1",
  text: DETACHED_TEXT,
  from: "assistant",
  entryId: "missing-branch-entry",
  prefix: "A detached source says ",
  suffix: " and nothing is lost.",
};

function quotePrompt(quote, body) {
  return serializeComposerQuotesForSend(`${encodeComposerQuoteToken(quote)} ${body}`);
}

function assistant(text, timestamp) {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    provider: "fixture",
    model: "fixture-model",
    stopReason: "stop",
    timestamp,
  };
}

function detail(id, messages, entryIds, previousCursor = null) {
  return createSessionDetail(id, {
    cwd: "/workspace/project",
    messages,
    entryIds,
    previousCursor,
    historyRevision: "quote-selection-revision",
    messageCount: messages.length,
  });
}

function basePayload(includeDetached = false) {
  const messages = [
    { role: "user", content: "The user's earlier request is still available.", timestamp: 1 },
    assistant(ASSISTANT_TEXT, 2),
    assistant("A later answer keeps the quoted context readable.", 3),
  ];
  const entryIds = [USER_ENTRY, ASSISTANT_ENTRY, "assistant-later"];
  for (let index = 0; index < 8; index += 1) {
    messages.push({
      role: "user",
      content: `Filler request ${index + 1} keeps the conversation tall enough to scroll.`,
      timestamp: 4 + index * 2,
    });
    entryIds.push(`filler-user-${index}`);
    messages.push(
      assistant(
        `Filler answer ${index + 1} adds another readable paragraph.\n\nThe reader can still jump to an earlier source.`,
        5 + index * 2,
      ),
    );
    entryIds.push(`filler-assistant-${index}`);
  }
  messages.push({
    role: "user",
    content: includeDetached
      ? quotePrompt(detachedQuote, "Please inspect this branch source.")
      : quotePrompt(userQuote, "Please explain this earlier request."),
    timestamp: 30,
  });
  entryIds.push(includeDetached ? "detached-user" : SENT_USER_ENTRY);
  messages.push(assistant("The final response follows the quoted context.", 31));
  entryIds.push("final-assistant");
  const current = detail(includeDetached ? "quote-selection-detached" : "quote-selection-base", messages, entryIds);
  return { detail: current, pages: {} };
}

function crossPagePayload() {
  const currentMessages = [
    { role: "user", content: "The current page starts here.", timestamp: 10 },
    assistant("The current page has a visible response.", 11),
    { role: "user", content: quotePrompt(olderQuote, "Please recover the older source."), timestamp: 12 },
  ];
  const current = detail(
    "quote-selection-cross-page",
    currentMessages,
    ["current-user", "current-assistant", "current-quote-user"],
    "older-cursor",
  );
  const older = detail(
    "quote-selection-older",
    [{ role: "user", content: "An old request preceded the current page.", timestamp: 1 }, assistant(OLDER_TEXT, 2)],
    ["older-user-entry", "older-assistant-entry"],
  );
  return { detail: current, pages: { "older-cursor": { context: older.context } } };
}

const js = (source) => window.webContents.executeJavaScript(source, true);
const page = (call) => js(`window.quoteSelection.${call}`);

async function settle() {
  await js("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  await new Promise((resolve) => setTimeout(resolve, 30));
}

async function waitFor(condition, label, diagnose) {
  const deadline = Date.now() + 8000;
  while (!(await js(`!!(${condition})`))) {
    if (Date.now() > deadline) {
      const detailText = diagnose ? ` (${JSON.stringify(await diagnose())})` : "";
      throw new Error(`Unmet page condition: ${label ?? condition}${detailText}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function focusWindow() {
  app.focus({ steal: true });
  window.focus();
  window.webContents.focus();
}

async function key(keyCode, modifiers = []) {
  focusWindow();
  window.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
  if (keyCode === "Enter") window.webContents.sendInputEvent({ type: "char", keyCode: "\r", modifiers });
  window.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
  await settle();
}

async function type(text) {
  focusWindow();
  for (const character of text) window.webContents.sendInputEvent({ type: "char", keyCode: character });
  await settle();
}

async function click(point) {
  focusWindow();
  window.webContents.sendInputEvent({ type: "mouseMove", x: point.x, y: point.y });
  window.webContents.sendInputEvent({ type: "mouseDown", x: point.x, y: point.y, button: "left", clickCount: 1 });
  window.webContents.sendInputEvent({ type: "mouseUp", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await settle();
}

async function drag(points) {
  focusWindow();
  window.webContents.sendInputEvent({ type: "mouseMove", x: points.start.x, y: points.start.y });
  window.webContents.sendInputEvent({
    type: "mouseDown",
    x: points.start.x,
    y: points.start.y,
    button: "left",
    clickCount: 1,
  });
  const steps = 12;
  for (let index = 1; index <= steps; index += 1) {
    const progress = index / steps;
    window.webContents.sendInputEvent({
      type: "mouseMove",
      x: Math.round(points.start.x + (points.end.x - points.start.x) * progress),
      y: Math.round(points.start.y + (points.end.y - points.start.y) * progress),
    });
  }
  window.webContents.sendInputEvent({
    type: "mouseUp",
    x: points.end.x,
    y: points.end.y,
    button: "left",
    clickCount: 1,
  });
  await settle();
}

async function capture(name) {
  await settle();
  const image = await window.webContents.capturePage();
  fs.writeFileSync(path.join(output, `${name}.png`), image.toPNG());
  return `${name}.png`;
}

async function fresh(payload, entryId = ASSISTANT_ENTRY) {
  await page(`load(${JSON.stringify(payload)})`);
  await waitFor(
    `window.quoteSelection.messageState(${JSON.stringify(entryId)}).exists`,
    "the fixture conversation is mounted",
  );
  await settle();
}

async function scene(name, payload, run) {
  const measurement = {};
  try {
    await fresh(
      payload,
      name === "cross-page-quote-jump-loads-older-assistant-message"
        ? "current-quote-user"
        : name === "branch-switch-detached-quote-shows-preserved-full-text"
          ? "detached-user"
          : ASSISTANT_ENTRY,
    );
    const result = await run(measurement);
    records.push({ name, measurement, screenshot: result?.screenshot, pass: true });
    console.log(`[quote-selection] ${name}: pass ${JSON.stringify(measurement)}`);
  } catch (error) {
    failures.push({ scene: name, error: error.stack ?? String(error) });
    records.push({ name, measurement, pass: false, error: String(error?.message ?? error) });
    console.error(`[quote-selection] ${name}: FAIL ${error?.message ?? error} ${JSON.stringify(measurement)}`);
    if (window && !window.isDestroyed()) await capture(`failure-${name}`).catch(() => {});
  }
}

async function run() {
  await app.whenReady();
  window = new BrowserWindow({
    width: 1280,
    height: 820,
    show: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.session.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: /^https?:/.test(details.url) }),
  );
  window.webContents.on("console-message", (event) => {
    if (event.level === "error") failures.push({ scene: "renderer", error: event.message });
  });
  await window.loadFile(path.join(directory, "index.html"));
  focusWindow();
  await waitFor("window.quoteSelection", "the real chat window harness is mounted");

  await scene("drag-selection-inserts-quote-chip-and-sends-structured-prompt", basePayload(), async (measurement) => {
    await page("scrollToEntry('assistant-target')");
    await settle();
    const points = await page("assistantSelectionPoints()");
    measurement.selection = points;
    await drag(points);
    await waitFor("window.quoteSelection.selectionPopover()?.label === 'Ask Dexon'", "the Ask Dexon pill appears");
    const pill = await page("selectionPopover()");
    const viewport = await js("({ width: innerWidth, height: innerHeight })");
    assert.ok(
      pill.rect.left >= 0 && pill.rect.right <= viewport.width,
      "the quote pill stays inside the viewport horizontally",
    );
    assert.ok(
      pill.rect.top >= 0 && pill.rect.bottom <= viewport.height,
      "the quote pill stays inside the viewport vertically",
    );
    await click({ x: pill.rect.left + pill.rect.width / 2, y: pill.rect.top + pill.rect.height / 2 });
    await waitFor("window.quoteSelection.composerQuotes().length === 1", "the selected text becomes a quote chip");
    assert.equal(await page("composerFocused()"), true, "clicking Ask Dexon focuses the composer");
    assert.equal(
      (await page("composerQuotes()"))[0].text,
      SELECTION_TEXT,
      "the quote chip keeps the verbatim selection",
    );
    await type("follow up");
    await key("Enter");
    await waitFor("window.quoteSelection.sentPrompts().length === 1", "the structured prompt is sent");
    const [sent] = await page("sentPrompts()");
    assert.ok(sent.startsWith('<quotes>\n<quote id="1" from="assistant" entry="assistant-target"'), sent);
    assert.ok(sent.includes(`\n${SELECTION_TEXT}\n</quote>`), "the sent envelope contains the full verbatim quote");
    assert.ok(sent.endsWith("</quotes>\n\n[quote:1] follow up"), sent);
    await waitFor("window.quoteSelection.sentUserQuote().count >= 2", "the optimistic sent user bubble is rendered");
    const bubble = await page("sentUserQuote()");
    assert.equal(bubble.rawXml, false, "the sent user bubble does not render raw quote XML");
    assert.ok(bubble.label.includes("bold alpha"), "the sent user bubble renders an inline Quote Chip");
    measurement.sent = sent;
    measurement.bubble = bubble;
    return { screenshot: await capture("01-drag-selection-send") };
  });

  await scene("selection-boundaries-ignore-composer-and-dismiss-on-escape", basePayload(), async (measurement) => {
    await page("focusComposer()");
    await page("insertText('composer-only text')");
    await settle();
    await drag(await page("composerSelectionPoints()"));
    assert.equal(await page("selectionPopover()"), null, "a composer selection never opens the quote pill");
    await page("scrollToEntry('assistant-target')");
    await settle();
    await click(await page("assistantPoint()"));
    assert.equal(await page("selectionPopover()"), null, "a single assistant click does not open the quote pill");
    await drag(await page("assistantSelectionPoints()"));
    await waitFor(
      "window.quoteSelection.selectionPopover()?.label === 'Ask Dexon'",
      "a valid assistant selection opens the quote pill",
    );
    await key("Escape");
    await waitFor("window.quoteSelection.selectionPopover() === null", "Escape dismisses the quote pill");
    await click(await page("assistantPoint()"));
    await drag(await page("assistantSelectionPoints('bold alpha and inline-code')"));
    await waitFor(
      "window.quoteSelection.selectionPopover()?.label === 'Ask Dexon'",
      "the next valid selection opens the pill again",
    );
    await click(await page("blankPoint()"));
    await waitFor("window.quoteSelection.selectionPopover() === null", "clicking blank space dismisses the quote pill");
    measurement.dismissed = true;
    return { screenshot: await capture("02-selection-boundaries") };
  });

  await scene("clicking-composer-and-bubble-quote-chips-jumps-and-highlights", basePayload(), async (measurement) => {
    await page("focusComposer()");
    await page(`insertQuote(${JSON.stringify(assistantQuote)})`);
    await page("insertText(' keep this draft')");
    await settle();
    await page("scrollToBottom()");
    await settle();
    assert.equal((await page("messageState('assistant-target')")).visible, false, "the target reply is scrolled away");
    await click(await page("composerQuoteCenter()"));
    await waitFor(
      "window.quoteSelection.messageState('assistant-target').highlighted && window.quoteSelection.messageState('assistant-target').fullyVisible",
      "the composer quote highlights its source and scrolls it fully into view",
    );
    const afterComposer = await page("messageState('assistant-target')");
    assert.equal(afterComposer.visible, true, "the composer quote jump scrolls the source into view");
    assert.ok((await page("draft()")).includes("keep this draft"), "jumping preserves the draft prose");
    await page("scrollToBottom()");
    await settle();
    await click(await page(`bubbleQuoteCenter(${JSON.stringify(SENT_USER_ENTRY)})`));
    await waitFor(
      "window.quoteSelection.messageState('user-target').highlighted && window.quoteSelection.messageState('user-target').fullyVisible",
      "the sent user quote highlights its source and scrolls it fully into view",
    );
    const afterBubble = await page("messageState('user-target')");
    assert.equal(afterBubble.visible, true, "the sent user quote jump scrolls its source into view");
    measurement.composerTarget = afterComposer;
    measurement.bubbleTarget = afterBubble;
    return { screenshot: await capture("03-quote-chip-jumps") };
  });

  await scene("cross-page-quote-jump-loads-older-assistant-message", crossPagePayload(), async (measurement) => {
    await click(await page("bubbleQuoteCenter('current-quote-user')"));
    await waitFor("window.quoteSelection.requests().length === 1", "the quote jump requests the older history page");
    await waitFor(
      "window.quoteSelection.messageState('older-assistant-entry').highlighted",
      "the older assistant source is highlighted",
    );
    const target = await page("messageState('older-assistant-entry')");
    assert.equal(target.exists, true, "the unloaded assistant message is inserted into the transcript");
    assert.equal(target.visible, true, "the loaded older assistant message is scrolled into view");
    measurement.requests = await page("requests()");
    measurement.target = target;
    return { screenshot: await capture("04-cross-page-jump") };
  });

  await scene("branch-switch-detached-quote-shows-preserved-full-text", basePayload(true), async (measurement) => {
    await click(await page("bubbleQuoteCenter('detached-user')"));
    await waitFor(
      "window.quoteSelection.bubbleQuoteState('detached-user')?.detached",
      "the missing source quote becomes detached",
    );
    await waitFor(
      "window.quoteSelection.detachedPreview()?.text === 'This full detached quote keeps every verbatim character.'",
      "the detached preview opens",
    );
    const preview = await page("detachedPreview()");
    assert.equal(preview.text, DETACHED_TEXT, "the detached preview preserves the full quote text");
    assert.ok(preview.hint.includes("Source message is not in this branch"), preview.hint);
    assert.ok(preview.hint.includes("Full quote preserved"), preview.hint);
    assert.deepEqual(await page("requests()"), [], "a detached quote does not retry pagination forever");
    assert.equal(
      (await page("messageState('detached-user')")).exists,
      true,
      "the branch remains rendered after detaching",
    );
    measurement.preview = preview;
    return { screenshot: await capture("05-detached-quote") };
  });

  assert.deepEqual(failures, [], "the real quote selection chat reports no renderer errors");
}

async function main() {
  let code = 0;
  try {
    await run();
  } catch (error) {
    code = 1;
    failures.push({ scene: "suite", error: error.stack ?? String(error) });
    console.error(error);
    if (window && !window.isDestroyed()) await capture("failure").catch(() => {});
  } finally {
    if (window && !window.isDestroyed()) {
      try {
        await js("window.quoteSelection?.close()");
      } catch (error) {
        code = 1;
        failures.push({ scene: "cleanup", error: String(error) });
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
          capturedAt: new Date().toISOString(),
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
