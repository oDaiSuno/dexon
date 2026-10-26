import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { app } from "electron";
import { configureSmokeEnvironment } from "../../src/smoke/environment.ts";
import { projectListPage } from "./project-list-page.mjs";

const firstScenes = [
  "01-default-space-created",
  "02-folders-joined",
  "03-drag-reorder",
  "04-drag-cancelled",
  "05-drag-above-default-refused",
];
const secondScenes = [
  "06-order-survived-restart",
  "07-missing-folder-greyed",
  "08-missing-folder-closed",
  "09-closed-after-restart",
];

configureSmokeEnvironment();
app.commandLine.appendSwitch("lang", "en-US");
const output = process.env.DEXON_PROJECT_LIST_OUT;
if (!output || !path.isAbsolute(output)) throw new Error("Project list check requires an evidence directory");
const phase = process.env.DEXON_PROJECT_LIST_PHASE;
if (phase !== "first" && phase !== "second") throw new Error(`Unknown project list phase ${phase}`);
const requiredScenes = phase === "first" ? firstScenes : secondScenes;
const entry = path.join(process.cwd(), "out/main/main.js");
const records = [];
const failures = [];
const consoleErrors = [];
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
  js(`(${projectListPage.toString()})(${JSON.stringify(operation)}, ${JSON.stringify(args ?? {})})`);
const watchdog = setTimeout(() => {
  console.error(`Project list ${phase} exceeded its deadline`);
  app.exit(1);
}, 100000);

async function waitFor(check, description, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error(`Production page did not show ${description}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function key(keyCode, modifiers = []) {
  window.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
  if (keyCode === "Enter") window.webContents.sendInputEvent({ type: "char", keyCode: "\r", modifiers });
  window.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
}

async function click(role, name) {
  await waitFor(() => page("exists", { role, name }), `${name} ready for native input`);
  const point = await page("point", { role, name });
  window.webContents.sendInputEvent({ type: "mouseMove", ...point });
  window.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...point });
  window.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...point });
}

async function screenshot(name, { waitForFrames = true } = {}) {
  if (waitForFrames) await js("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  const image = await observe(() => window.webContents.capturePage(), "Production screenshot");
  fs.writeFileSync(path.join(output, `${phase}-${name}.png`), image.toPNG());
  fs.writeFileSync(path.join(output, `${phase}-${name}-small.png`), image.resize({ width: 640 }).toPNG());
  return `${phase}-${name}.png`;
}

async function scene(name, check) {
  currentScene = name;
  console.log(`project-list-${phase}: ${name}`);
  const observation = await check();
  records.push({ name, pass: true, observation, screenshot: await screenshot(name) });
}

const sameOrder = (expected) => async () => JSON.stringify(await page("order")) === JSON.stringify(expected);

async function openFolder(folder) {
  await click("button", "Actions for Default space");
  await waitFor(() => page("exists", { role: "searchbox", name: "Search or open a project…" }), "the project switcher");
  await window.webContents.insertText(folder);
  await waitFor(() => page("exists", { role: "menuitem", name: `Open ${folder}` }), `the offer to open ${folder}`);
  await key("Enter");
  await waitFor(async () => (await page("order")).includes(path.basename(folder)), `${folder} in the project list`);
}

async function backToDefault(current) {
  await click("button", `Actions for ${current}`);
  await waitFor(() => page("exists", { role: "menuitem", name: "Back to default space" }), "the project card");
  await click("menuitem", "Back to default space");
  await waitFor(() => page("exists", { role: "button", name: "Actions for Default space" }), "the default space");
}

async function drag(fromName, toName, { cancel = false, outside = false } = {}) {
  const from = await page("rowPoint", { name: fromName });
  const to = outside ? { x: 900, y: 400 } : await page("rowPoint", { name: toName });
  const target = outside ? to : { x: to.x, y: to.y - 8 };
  window.webContents.sendInputEvent({ type: "mouseMove", ...from });
  window.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...from });
  for (let step = 1; step <= 12; step++) {
    const x = Math.round(from.x + ((target.x - from.x) * step) / 12);
    const y = Math.round(from.y + ((target.y - from.y) * step) / 12);
    window.webContents.sendInputEvent({ type: "mouseMove", x, y, modifiers: ["leftButtonDown"] });
    await js("new Promise(resolve => requestAnimationFrame(resolve))");
  }
  if (cancel) await key("Escape");
  window.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...target });
  await js("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
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

async function runFirst(folders) {
  await scene("01-default-space-created", async () => {
    await waitFor(() => page("exists", { role: "button", name: "Show file panel" }), "a healthy App", 15000);
    assert.doesNotMatch(await page("text"), /UI crashed|Cannot connect to Agent Host/);
    window.show();
    window.setContentSize(1280, 760);
    await waitFor(sameOrder(["Default space"]), "only the default space in the project list");
    assert.equal(fs.statSync(folders.personal).isDirectory(), true, "the default space folder was created");
    return { order: await page("order") };
  });
  await scene("02-folders-joined", async () => {
    await openFolder(folders.alpha);
    await backToDefault("alpha");
    await openFolder(folders.beta);
    await backToDefault("beta");
    await openFolder(folders.gamma);
    await backToDefault("gamma");
    await waitFor(sameOrder(["Default space", "gamma", "beta", "alpha"]), "newest folders right below the default");
    const order = await page("order");
    return { order };
  });
  await scene("03-drag-reorder", async () => {
    await drag("alpha", "gamma");
    await waitFor(sameOrder(["Default space", "alpha", "gamma", "beta"]), "alpha dragged above gamma");
    const order = await page("order");
    return { order };
  });
  await scene("04-drag-cancelled", async () => {
    await drag("beta", "alpha", { cancel: true });
    await drag("gamma", null, { outside: true });
    assert.deepEqual(await page("order"), ["Default space", "alpha", "gamma", "beta"]);
    const order = await page("order");
    return { order };
  });
  await scene("05-drag-above-default-refused", async () => {
    await drag("beta", "Default space");
    assert.equal((await page("order"))[0], "Default space");
    await js("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    const current = JSON.stringify(await page("order"));
    assert.ok(
      current === JSON.stringify(["Default space", "alpha", "gamma", "beta"]) ||
        current === JSON.stringify(["Default space", "beta", "alpha", "gamma"]),
      `a drop above the default space either changes nothing or lands right below it: ${current}`,
    );
    const order = await page("order");
    if (order[1] === "beta") {
      await drag("alpha", "beta");
      await drag("gamma", "beta");
      await waitFor(sameOrder(["Default space", "alpha", "gamma", "beta"]), "the order restored for the restart");
    }
    fs.renameSync(folders.gamma, folders.gammaMoved);
    return { orderAfterDrop: order, finalOrder: await page("order") };
  });
}

async function runSecond(folders) {
  await scene("06-order-survived-restart", async () => {
    await waitFor(() => page("exists", { role: "button", name: "Show file panel" }), "a healthy App", 15000);
    window.show();
    window.setContentSize(1280, 760);
    await waitFor(sameOrder(["Default space", "alpha", "gamma", "beta"]), "the saved order after a real restart");
    const order = await page("order");
    return { order };
  });
  await scene("07-missing-folder-greyed", async () => {
    await waitFor(
      async () => (await page("rowText", { name: "gamma" }))?.includes("Folder not found"),
      "gamma marked Folder not found",
    );
    const color = await page("rowNameColor", { name: "gamma" });
    const tertiary = await page("tokenColor", { token: "--fx-text-tertiary" });
    const body = await page("rowNameColor", { name: "alpha" });
    assert.equal(color, tertiary, "the missing folder's name uses the tertiary text colour from the design");
    assert.notEqual(body, tertiary, "a present folder's name does not");
    return { color, tertiary, body };
  });
  await scene("08-missing-folder-closed", async () => {
    const point = await page("rowPoint", { name: "gamma" });
    window.webContents.sendInputEvent({ type: "mouseMove", ...point });
    await click("button", "Actions for gamma");
    await waitFor(
      async () => (await page("text")).includes("This folder was moved or deleted. Its sessions are kept."),
      "the missing folder note",
    );
    await click("menuitem", "Close project");
    await waitFor(sameOrder(["Default space", "alpha", "beta"]), "gamma closed");
    const order = await page("order");
    return { order };
  });
  await scene("09-closed-after-restart", async () => {
    const stateFile = path.join(process.env.PI_DESKTOP_SMOKE_USER_DATA, "ui-state.json");
    const canonical = (list) => JSON.stringify((list ?? []).map((folder) => fs.realpathSync(folder)));
    const expected = canonical([folders.personal, folders.alpha, folders.beta]);
    await waitFor(
      () => canonical(JSON.parse(fs.readFileSync(stateFile, "utf8")).openProjects) === expected,
      "the closed project removed from the saved list on disk",
    );
    return { openProjects: JSON.parse(fs.readFileSync(stateFile, "utf8")).openProjects };
  });
}

async function run() {
  const home = process.env.PI_DESKTOP_SMOKE_HOME;
  const folders = {
    personal: path.join(home, ".dexon"),
    alpha: path.join(home, "work", "alpha"),
    beta: path.join(home, "work", "beta"),
    gamma: path.join(home, "work", "gamma"),
    gammaMoved: path.join(home, "work", "gamma-moved"),
  };
  if (phase === "first") {
    assert.equal(fs.existsSync(folders.personal), false, "the disposable home starts without the default space folder");
    for (const folder of [folders.alpha, folders.beta, folders.gamma]) fs.mkdirSync(folder, { recursive: true });
  }
  await loadedWindow;
  if (phase === "first") await runFirst(folders);
  else await runSecond(folders);
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
        check: `project-list-${phase}`,
        pass,
        entry,
        evidenceDirectory: output,
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
    let failurePage = null;
    if (window && !window.isDestroyed()) {
      const [pageResult, imageResult] = await Promise.allSettled([
        (async () => {
          const text = await page("text");
          fs.writeFileSync(
            path.join(output, `${phase}-failure-page.json`),
            JSON.stringify({ scene: currentScene, text }, null, 2),
          );
          return `${phase}-failure-page.json`;
        })(),
        screenshot(`${currentScene}-failed`, { waitForFrames: false }),
      ]);
      if (pageResult.status === "fulfilled") failurePage = pageResult.value;
      else failures.push(`Failure page capture: ${pageResult.reason}`);
      if (imageResult.status === "fulfilled") image = imageResult.value;
      else failures.push(`Failure screenshot capture: ${imageResult.reason}`);
    }
    records.push({ name: currentScene, pass: false, error: error.message, screenshot: image, failurePage });
    console.error(`Project list ${phase} failed at ${currentScene}:`, error);
  })
  .finally(() => app.quit());

const loadMain = createRequire(path.join(process.cwd(), "package.json"));
const registerProtocol = app.setAsDefaultProtocolClient;
app.setAsDefaultProtocolClient = () => false;
try {
  loadMain(entry);
} finally {
  app.setAsDefaultProtocolClient = registerProtocol;
}
