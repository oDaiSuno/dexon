import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { app } from "electron";
import { configureSmokeEnvironment } from "../../src/smoke/environment.ts";
import { pingProductionHost, waitForProductionRenderer } from "../../src/smoke/production-renderer-probe.ts";
import { readingPositionPage } from "./reading-position-page.mjs";
import { createConversationReader } from "./reading-position-reader.mjs";
import {
  longReadingQuestions,
  longReadingTitle,
  parentReadingReply,
  parentReadingTitle,
  readingPositionScenes as requiredScenes,
  seedReadingPositionSessions,
  shortReadingTitle,
} from "../fixtures/reading-position-native.mjs";

configureSmokeEnvironment();
app.commandLine.appendSwitch("lang", "en-US");
const seeded = await seedReadingPositionSessions();
const output = process.env.DEXON_READING_POSITION_OUT;
if (!output || !path.isAbsolute(output)) throw new Error("Production reading position requires an evidence directory");
const entry = path.join(process.cwd(), "out/main/main.js");
const RECORD_TOLERANCE = 24;
const records = [];
const failures = [];
const consoleErrors = [];
const LOADING = "Loading earlier messages…";

let window;
let currentScene = requiredScenes[0];

const observe = async (action, description) => {
  let timer;
  try {
    return await Promise.race([
      action(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${description} exceeded 20s`)), 20000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};
const js = (code) => observe(() => window.webContents.executeJavaScript(code, true), "Production page observation");
const page = (operation, args) =>
  js(`(${readingPositionPage.toString()})(${JSON.stringify(operation)}, ${JSON.stringify(args ?? {})})`);
const exists = (role, name) => page("exists", { role, name });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const watchdog = setTimeout(() => {
  console.error("Production reading position exceeded its deadline");
  app.exit(1);
}, 360000);

async function waitFor(check, description, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error(`Production page did not show ${description}`);
    await sleep(30);
  }
}

async function nextFrames() {
  await js("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
}

async function screenshot(name) {
  await nextFrames();
  const image = await observe(() => window.webContents.capturePage(), "Production screenshot");
  fs.writeFileSync(path.join(output, `${name}.png`), image.toPNG());
  fs.writeFileSync(path.join(output, `${name}-small.png`), image.resize({ width: 640 }).toPNG());
  return `${name}.png`;
}

async function clickPoint(point) {
  assert.ok(point, "the clicked control is on screen");
  assert.ok(point.hit !== false, `the clicked control is reachable by a real pointer (covered by ${point.coveredBy})`);
  window.webContents.sendInputEvent({ type: "mouseMove", x: point.x, y: point.y });
  window.webContents.sendInputEvent({ type: "mouseDown", x: point.x, y: point.y, button: "left", clickCount: 1 });
  window.webContents.sendInputEvent({ type: "mouseUp", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await nextFrames();
}

async function conversationShown() {
  return (await page("conversation")) !== null;
}

async function clickHistory(title) {
  await waitFor(async () => (await page("historyPoint", { contains: title })) !== null, `the ${title} row`);
  await clickPoint(await page("historyPoint", { contains: title }));
}

async function clickButton(name) {
  await waitFor(() => exists("button", name), `the ${name} button`);
  await clickPoint(await page("point", { role: "button", name }));
}

const reader = createConversationReader({
  page,
  clickButton,
  sleep,
  waitFor,
  nextFrames,
  tolerance: RECORD_TOLERANCE,
  loading: LOADING,
  wheel: (deltaY, center) => {
    window.webContents.sendInputEvent({ type: "mouseWheel", ...center, deltaX: 0, deltaY, canScroll: true });
  },
});
const { settleOnSentence, loadEarlierPages, scrollToTopOfLoadedMessages, expectSamePosition } = reader;

async function openConversation(title, sentence) {
  await waitFor(() => exists("navigation", "Main navigation"), "the Main navigation");
  await clickHistory(title);
  await waitFor(
    async () => (await conversationShown()) && (await page("text")).includes(sentence),
    `${title} on screen`,
  );
}

async function scene(name, check) {
  currentScene = name;
  console.log(`production-reading-position: ${name}`);
  const observation = await check();
  records.push({ name, pass: true, observation, screenshot: await screenshot(name) });
}

async function latestDistance() {
  return (await page("conversation")).distanceFromBottom;
}

const loadedWindow = new Promise((resolve, reject) => {
  app.once("browser-window-created", (_event, created) => {
    window = created;
    window.webContents.setBackgroundThrottling(false);
    window.webContents.on("console-message", (event) => {
      if (event.level === "error") consoleErrors.push(event.message);
    });
    window.webContents.once("did-finish-load", () => resolve(created));
    window.webContents.on("did-fail-load", (_event, code, description, _url, mainFrame) => {
      if (mainFrame && code !== -3) reject(new Error(`Production renderer failed: ${description}`));
    });
  });
});

// An arriving page prepends its messages above the reader, so the content the
// conversation can scroll through grows. Wait for that growth to settle.
async function run() {
  await loadedWindow;
  await scene("01-first-open", async () => {
    await waitForProductionRenderer(window);
    await pingProductionHost(window);
    await waitFor(() => exists("button", "Show file panel"), "a healthy App", 30000);
    assert.doesNotMatch(await page("text"), /UI crashed|Cannot connect to Agent Host/);
    window.webContents.closeDevTools();
    window.show();
    window.setContentSize(1280, 760);
    window.focus();
    window.webContents.focus();
    await openConversation(longReadingTitle, `Question ${longReadingQuestions} of ${longReadingTitle}`);
    const deadline = Date.now() + 60000;
    let stable = 0;
    let distance = null;
    while (stable < 3) {
      assert.ok(Date.now() < deadline, "the long conversation reaches its newest message");
      await nextFrames();
      const next = await latestDistance();
      stable = next === distance ? stable + 1 : 0;
      distance = next;
    }
    const conversation = await page("conversation");
    assert.ok(
      Math.abs(distance) <= 1,
      `the first open ends at the very bottom of the newest message (${distance}px above it)`,
    );
    assert.equal(conversation.scrollToBottomButton, false, "the reader is not invited to jump to a bottom they are at");
    return { distance, conversation, sessionFileBytes: seeded.longBytes };
  });
  await scene("02-sidebar-return", async () => {
    const watched = await settleOnSentence(3);
    await openConversation(shortReadingTitle, `Question 01 of ${shortReadingTitle}`);
    await clickHistory(longReadingTitle);
    await waitFor(
      async () => (await conversationShown()) && (await page("text")).includes(watched.text),
      "the long conversation again",
    );
    const measurement = await expectSamePosition(watched, "sidebar");
    return measurement;
  });
  await scene("03-resources-return", async () => {
    const watched = await settleOnSentence(2);
    await clickButton("Plugins & Skills");
    await waitFor(() => exists("heading", "Plugins & Skills"), "Plugins & Skills");
    await clickHistory(longReadingTitle);
    await waitFor(
      async () => (await conversationShown()) && (await page("text")).includes(watched.text),
      "the long conversation again",
    );
    return expectSamePosition(watched, "Plugins & Skills");
  });
  await scene("04-settings-return", async () => {
    const watched = await settleOnSentence(1);
    await clickButton("Settings");
    await waitFor(() => exists("region", "Settings"), "Settings");
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
    await waitFor(async () => !(await exists("region", "Settings")), "Settings to close on Escape");
    await waitFor(
      async () => (await conversationShown()) && (await page("text")).includes(watched.text),
      "the long conversation again",
    );
    return expectSamePosition(watched, "Settings");
  });
  await scene("05-deep-link-return", async () => {
    const watched = await settleOnSentence(1);
    await openConversation(shortReadingTitle, `Question 01 of ${shortReadingTitle}`);
    window.webContents.send("deep-link:session", seeded.longId);
    await waitFor(
      async () => (await conversationShown()) && (await page("text")).includes(watched.text),
      "the deep-linked conversation",
    );
    return expectSamePosition(watched, "deep link");
  });
  await scene("06-earlier-page-return", async () => {
    const loads = await loadEarlierPages(2);
    await scrollToTopOfLoadedMessages();
    const watched = await settleOnSentence(0);
    await openConversation(shortReadingTitle, `Question 01 of ${shortReadingTitle}`);
    await clickHistory(longReadingTitle);
    await waitFor(conversationShown, "the long conversation panel again");
    const measurement = await expectSamePosition(watched, "earlier page");
    return { ...measurement, earlierPageLoadsBeforeLeaving: loads };
  });
  await scene("07-independent", async () => {
    const reading = await settleOnSentence(1);
    await openConversation(shortReadingTitle, `Question 01 of ${shortReadingTitle}`);
    const short = await settleOnSentence(2);
    await clickHistory(longReadingTitle);
    await waitFor(
      async () => (await conversationShown()) && (await page("text")).includes(reading.text),
      "the long conversation again",
    );
    const longAgain = await expectSamePosition(reading, "independent long");
    await clickHistory(shortReadingTitle);
    await waitFor(
      async () => (await conversationShown()) && (await page("text")).includes(short.text),
      "the short conversation again",
    );
    const shortAgain = await expectSamePosition(short, "independent short");
    return { long: longAgain, short: shortAgain };
  });
  await scene("08-child-from-parent-link", async () => {
    const rows = await page("historyRows");
    const parentRow = rows.find((row) => row.name.includes(parentReadingTitle));
    const childRow = rows.find((row) => row.name.includes(longReadingTitle));
    assert.ok(parentRow, "the parent conversation is listed in the sidebar");
    assert.ok(childRow, "the child conversation is listed in the sidebar");
    assert.ok(childRow.top > parentRow.top, "the child conversation is listed under its parent");
    assert.ok(childRow.left >= parentRow.left, "the child conversation is not placed left of its parent");

    await openConversation(longReadingTitle, `Question ${longReadingQuestions} of ${longReadingTitle}`);
    const watched = await settleOnSentence(1);
    await clickHistory(parentReadingTitle);
    await waitFor(
      async () => (await conversationShown()) && (await page("text")).includes(parentReadingReply),
      "the parent conversation",
    );
    // A reader opens the parent's process details to see what it delegated; the
    // session card inside is the way to the child conversation.
    if ((await page("processDetailsExpanded")) === false) {
      await clickPoint(await page("pointByTitle", { contains: "process details" }));
      await waitFor(async () => (await page("processDetailsExpanded")) === true, "the open process details");
    }
    const linkName = `Open session ${longReadingTitle}`;
    await waitFor(() => exists("button", linkName), `the ${linkName} link`);
    // The delegation card is a link; a reader who sees nothing happen clicks
    // again, so the check does the same and records how many clicks it took.
    let attempts = 0;
    for (; attempts < 3; attempts += 1) {
      await clickButton(linkName);
      const opened = await waitFor(
        async () => (await conversationShown()) && (await page("text")).includes(watched.text),
        "the linked child conversation",
        6000,
      ).then(
        () => true,
        () => false,
      );
      if (opened) break;
    }
    assert.ok(attempts < 3, "the parent's delegation card opens the child conversation");
    attempts += 1;
    const measurement = await expectSamePosition(watched, "child from parent link");
    return { ...measurement, clicksNeeded: attempts, rows: { parent: parentRow, child: childRow } };
  });
  assert.deepEqual(consoleErrors, [], "production renderer emitted no errors");
}

app.once("will-quit", () => {
  const pass =
    failures.length === 0 &&
    consoleErrors.length === 0 &&
    requiredScenes.every((name) => records.some((record) => record.name === name && record.pass));
  fs.writeFileSync(
    process.env.DEXON_ELECTRON_RESULT,
    JSON.stringify(
      {
        completed: true,
        pid: process.pid,
        check: "production-reading-position",
        pass,
        entry,
        evidenceDirectory: output,
        seeds: { longFile: seeded.longFile, longBytes: seeded.longBytes, longId: seeded.longId },
        shutdown: "will-quit",
        platform: process.platform,
        arch: process.arch,
        records,
        failures,
        consoleErrors,
        blockedScenes: requiredScenes.filter((name) => !records.some((record) => record.name === name)),
      },
      null,
      2,
    ),
  );
  clearTimeout(watchdog);
});

void run()
  .catch(async (error) => {
    failures.push(error.stack ?? String(error));
    let image = null;
    if (window && !window.isDestroyed()) {
      try {
        const text = await page("text");
        fs.writeFileSync(
          path.join(output, "failure-page.json"),
          JSON.stringify({ scene: currentScene, text }, null, 2),
        );
        image = await screenshot(`${currentScene}-failed`);
      } catch (captureError) {
        failures.push(`Failure capture: ${captureError}`);
      }
    }
    records.push({ name: currentScene, pass: false, error: error.message, screenshot: image });
    console.error(`Production reading position failed at ${currentScene}:`, error);
  })
  .finally(() => app.quit());

// Exclude only OS protocol association so a check cannot change the user's
// default app. All product startup, windows, preload, IPC and Host stay real.
const loadMain = createRequire(path.join(process.cwd(), "package.json"));
const registerProtocol = app.setAsDefaultProtocolClient;
app.setAsDefaultProtocolClient = () => false;
try {
  loadMain(entry);
} finally {
  app.setAsDefaultProtocolClient = registerProtocol;
}
