import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { app } from "electron";
import { configureSmokeEnvironment } from "../../src/smoke/environment.ts";
import { waitForProductionRenderer, pingProductionHost } from "../../src/smoke/production-renderer-probe.ts";
import {
  nativeNavigationScenes as requiredScenes,
  nativeHistoryTitle,
  nativeSkillInitial,
  nativeSkillSaved,
  seedNativeNavigation,
} from "../fixtures/app-navigation-native.mjs";
import { remainingSettings, railEntries } from "../fixtures/app-navigation-data.mjs";
import { productionPage } from "./app-navigation-page.mjs";
import { productionResourceProbe } from "./app-navigation-host-probe.mjs";
import { captureFinalVisuals } from "./app-navigation-visuals.mjs";

configureSmokeEnvironment();
app.commandLine.appendSwitch("lang", "en-US");
await seedNativeNavigation();
const output = process.env.DEXON_NAVIGATION_OUT;
if (!output || !path.isAbsolute(output)) throw new Error("Production navigation requires an evidence directory");
const entry = path.join(process.cwd(), "out/main/main.js");
const records = [];
const failures = [];
const consoleErrors = [];
let window;
let currentScene = "01-production-startup";
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
  js(`(${productionPage.toString()})(${JSON.stringify(operation)}, ${JSON.stringify(args ?? {})})`);
const exists = (role, name) => page("exists", { role, name });
const attribute = (role, name, attribute) => page("attribute", { role, name, attribute });
const caseless = (value) => (Array.isArray(value) ? value.map(caseless) : String(value).toLowerCase());
const watchdog = setTimeout(() => {
  console.error("Production navigation exceeded its deadline");
  app.exit(1);
}, 90000);

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

async function replaceText(name, value) {
  await click("textbox", name);
  await waitFor(async () => {
    const selection = await page("selection");
    return selection.focused && selection.name === name;
  }, `${name} focused before editing`);
  window.webContents.selectAll();
  await waitFor(async () => {
    const selection = await page("selection");
    return selection.start === 0 && selection.end === selection.length;
  }, `${name} fully selected before replacement`);
  await window.webContents.insertText(value);
  await waitFor(async () => (await page("value", { role: "textbox", name })) === value, `${name} replacement text`);
}

async function click(role, name, text) {
  if (role) await waitFor(() => exists(role, name), `${name} ready for native input`);
  const point = await page("point", { role, name, text });
  window.webContents.sendInputEvent({ type: "mouseMove", ...point });
  window.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...point });
  window.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...point });
}

async function screenshot(name, { waitForFrames = true } = {}) {
  if (waitForFrames) await js("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  const image = await observe(() => window.webContents.capturePage(), "Production screenshot");
  fs.writeFileSync(path.join(output, `${name}.png`), image.toPNG());
  fs.writeFileSync(path.join(output, `${name}-small.png`), image.resize({ width: 640 }).toPNG());
  return `${name}.png`;
}

async function scene(name, check) {
  currentScene = name;
  console.log(`production-app-navigation: ${name}`);
  const observation = await check();
  records.push({ name, pass: true, observation, screenshot: await screenshot(name) });
}

async function reloadPage() {
  let timer;
  let loaded;
  try {
    await new Promise((resolve, reject) => {
      loaded = resolve;
      window.webContents.once("did-finish-load", loaded);
      timer = setTimeout(() => reject(new Error("Production renderer reload timed out")), 20000);
      window.webContents.reload();
    });
    await waitForProductionRenderer(window);
    await waitFor(() => exists("button", "Show file panel"), "the reloaded application");
    window.focus();
    window.webContents.focus();
  } finally {
    clearTimeout(timer);
    window.webContents.removeListener("did-finish-load", loaded);
  }
}

async function focusByTab(name) {
  for (let attempts = 0; attempts < 100; attempts++) {
    const previous = await page("focus");
    await key("Tab");
    await waitFor(async () => {
      const current = await page("focus");
      return current.name !== previous.name || JSON.stringify(current.rect) !== JSON.stringify(previous.rect);
    }, "native Tab to move focus");
    const focus = await page("focus");
    if (caseless(focus.name) === caseless(name) && focus.inNavigation) return focus;
  }
  throw new Error(`Real Tab input did not reach ${name}`);
}

function assertNavigationWidth(measurement, expected) {
  assert.ok(measurement, "production uses the approved Main navigation");
  assert.ok(Math.abs(measurement.rect.width - expected) <= 0.5, `production navigation occupies ${expected}px`);
  assert.ok(measurement.scrollWidth <= measurement.clientWidth + 1, "navigation does not overflow horizontally");
  assert.ok(
    measurement.documentScrollWidth <= measurement.documentWidth + 1,
    "the full production page does not overflow horizontally",
  );
  if (measurement.resourceHeading) {
    assert.ok(measurement.resourceHeading.x >= measurement.rect.right - 1, "resources are not under the rail");
    const centeredInset = measurement.resourceColumn
      ? Math.max(0, (measurement.documentWidth - measurement.rect.right - measurement.resourceColumn.width) / 2)
      : 0;
    assert.ok(
      measurement.resourceHeading.x <= measurement.rect.right + centeredInset + 40,
      "the former sidebar does not leave a hidden-width gap",
    );
  }
}

async function navigationWidth(expected) {
  const deadline = Date.now() + 8000;
  for (;;) {
    const measurement = await page("navigation");
    try {
      // A changed toggle label can precede the width and content-position transition.
      // Retry the actual layout assertions, preserving the last failure at the deadline.
      assertNavigationWidth(measurement, expected);
      return measurement;
    } catch (error) {
      if (!(error instanceof assert.AssertionError) || Date.now() >= deadline) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
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

async function run() {
  await loadedWindow;
  await scene("01-production-startup", async () => {
    await waitForProductionRenderer(window);
    await pingProductionHost(window);
    await waitFor(
      () => exists("button", "Show file panel"),
      "a healthy App, rather than its connection or error screen",
      15000,
    );
    assert.doesNotMatch(await page("text"), /UI crashed|Cannot connect to Agent Host/);
    window.webContents.closeDevTools();
    window.show();
    window.setContentSize(1280, 760);
    window.focus();
    window.webContents.focus();
    const seeded = await js(`(${productionResourceProbe.toString()})()`);
    assert.ok(
      seeded.packages.some((pkg) => pkg.packageName === "production-navigation-plugin" && pkg.status === "loaded"),
      "the real Host resolves the local plugin fixture",
    );
    assert.ok(
      seeded.skills.some((skill) => skill.name === "shared-checklist"),
      "the real Host resolves the global skill fixture",
    );
    assert.equal(seeded.content, nativeSkillInitial, "the real Host reads the seeded personal skill");
    await js("document.fonts.ready.then(() => undefined)");
    return {
      entry,
      realMainPreloadAndHost: true,
      realResourceFixturesDiscovered: true,
      viewport: window.getContentSize(),
    };
  });
  await scene("02-expanded-resources", async () => {
    await waitFor(() => exists("navigation", "Main navigation"), "the official Main navigation");
    await click("button", "Plugins & Skills");
    await waitFor(() => exists("heading", "Plugins & Skills"), "Resources as the main page");
    await click("button", "Manage sources");
    await waitFor(
      async () => (await page("text")).includes("production-navigation-plugin"),
      "the real locally configured plugin",
    );
    assert.equal(await exists("region", "Settings"), false);
    return navigationWidth(224);
  });
  await scene("03-plugin-persistence", async () => {
    await click("button", "Disable package");
    await waitFor(() => exists("button", "Enable package"), "the disabled plugin");
    await reloadPage();
    await click("button", "Plugins & Skills");
    await click("button", "Manage sources");
    await waitFor(() => exists("button", "Enable package"), "the disabled plugin after a real renderer reload");
    assert.equal(await attribute("button", "Enable package", "aria-pressed"), "false");
    return { persistedDisabled: true, readBackAfterRendererReload: true };
  });
  await scene("04-skill-persistence", async () => {
    await click("tab", "Skills");
    await waitFor(async () => (await page("text")).includes("production-checklist"), "the real personal skill");
    await click(undefined, undefined, "production-checklist");
    await waitFor(
      async () => (await page("value", { role: "textbox", name: "Skill markdown content" })) === nativeSkillInitial,
      "the original skill file content",
    );
    await replaceText("Skill markdown content", nativeSkillSaved);
    await waitFor(
      async () => (await attribute("button", "Save changes", "disabled")) === null,
      "an enabled Save changes button",
    );
    await click("button", "Save changes");
    await waitFor(
      async () => (await attribute("button", "Save changes", "disabled")) !== null,
      "a completed skill save",
    );
    await reloadPage();
    await click("button", "Plugins & Skills");
    await click("button", "Manage sources");
    await waitFor(() => exists("tab", "Skills"), "resource tabs after a real renderer reload");
    await click("tab", "Skills");
    await waitFor(async () => (await page("text")).includes("production-checklist"), "the reopened skill list");
    await click(undefined, undefined, "production-checklist");
    await waitFor(
      async () => (await page("value", { role: "textbox", name: "Skill markdown content" })) === nativeSkillSaved,
      "the saved file read back through the real Host",
    );
    assert.ok((await page("text")).includes("shared-checklist"));
    return { savedFileReadBack: true, readBackAfterRendererReload: true, globalSkillVisible: true };
  });
  await scene("05-resource-keyboard", async () => {
    await click("tab", "Plugins");
    await key("Right");
    await waitFor(
      async () =>
        (await attribute("tab", "Skills", "aria-selected")) === "true" && (await page("focus")).name === "Skills",
      "Skills selected and focused by the real Right arrow",
    );
    await key("Left");
    await waitFor(
      async () =>
        (await attribute("tab", "Plugins", "aria-selected")) === "true" && (await page("focus")).name === "Plugins",
      "Plugins selected and focused by the real Left arrow",
    );
    return page("focus");
  });
  await scene("06-rail-layout-and-focus", async () => {
    await waitFor(() => exists("button", nativeHistoryTitle), "the seeded conversation before collapse");
    const historyFocus = await focusByTab(nativeHistoryTitle);
    assert.ok(historyFocus.inNavigation && historyFocus.visible && historyFocus.hit && historyFocus.focusVisible);
    await click("button", "Hide sidebar");
    await waitFor(() => exists("button", "Show sidebar"), "the collapsed rail");
    const measurement = await navigationWidth(52);
    assert.equal(await exists("button", nativeHistoryTitle), false, "the former history row is not exposed");
    assert.deepEqual(caseless(measurement.buttons), caseless(railEntries));
    await focusByTab("Show sidebar");
    const focusOrder = [];
    for (const name of railEntries.slice(1)) {
      await key("Tab");
      await waitFor(async () => caseless((await page("focus")).name) === caseless(name), `${name} focused by Tab`);
      const focus = await page("focus");
      assert.equal(caseless(focus.name), caseless(name));
      assert.ok(focus.inNavigation && focus.visible && focus.hit && focus.focusVisible);
      focusOrder.push(focus.name);
    }
    await key("Tab");
    await waitFor(async () => !(await page("focus")).inNavigation, "Tab to leave the collapsed navigation");
    assert.equal((await page("focus")).inNavigation, false, "collapsed history has no keyboard-focus ghosts");
    return { measurement, focusOrder, historyBeforeCollapse: { title: nativeHistoryTitle, focus: historyFocus } };
  });
  await scene("07-rail-settings", async () => {
    await click("button", "Settings");
    await waitFor(() => exists("region", "Settings"), "Settings from the rail");
    assert.deepEqual((await page("settingsTabs")).sort(), [...remainingSettings].sort());
    await key("Escape");
    await waitFor(async () => !(await exists("region", "Settings")), "Settings closed by Escape");
    return { categories: remainingSettings };
  });
  await scene("08-new-session-and-expand", async () => {
    await click("button", railEntries[1]);
    await waitFor(() => exists("group", "Message input"), "a real new-session composer");
    assert.equal(await exists("heading", "Plugins & Skills"), false);
    await click("button", "Show sidebar");
    await waitFor(() => exists("button", "Personal space"), "restored friendly workspace controls");
    const measurement = await navigationWidth(224);
    assert.deepEqual(measurement.currentPage, [], "an empty session marks no navigation entry as the current page");
    await waitFor(() => exists("button", nativeHistoryTitle), "the original conversation after expansion");
    return { ...measurement, restoredHistory: nativeHistoryTitle };
  });
  await scene("09-space-menu-keyboard", async () => {
    const focus = await focusByTab("Actions for Personal space");
    assert.equal(focus.name, "Actions for Personal space");
    assert.ok(
      focus.focusVisible && focus.outlineWidth > 0 && focus.outlineStyle !== "none",
      "workspace has a visible real-keyboard focus ring",
    );
    await key("Enter");
    await waitFor(() => exists("menu", "Personal space"), "the space menu opened by Enter");
    await key("Escape");
    await waitFor(async () => !(await exists("menu", "Personal space")), "the space menu closed by Escape");
    return { focus, keyboardOpenAndClose: true };
  });
  await scene("10-minimum-window-width", async () => {
    window.setContentSize(900, 760);
    await waitFor(async () => (await page("navigation"))?.documentWidth <= 900, "the 900px minimum window");
    const measurement = await navigationWidth(224);
    await waitFor(() => exists("group", "Message input"), "the chat composer beside the navigation");
    return { ...measurement, viewport: window.getContentSize() };
  });
  await scene("11-final-visuals", async () => ({
    screens: await captureFinalVisuals({ window, js, click, exists, waitFor, screenshot }),
  }));
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
        check: "production-app-navigation",
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
      // Neither diagnostic depends on the other succeeding or producing another frame.
      const [pageResult, imageResult] = await Promise.allSettled([
        (async () => {
          const text = await page("text");
          fs.writeFileSync(
            path.join(output, "failure-page.json"),
            JSON.stringify({ scene: currentScene, text }, null, 2),
          );
          return "failure-page.json";
        })(),
        screenshot(`${currentScene}-failed`, { waitForFrames: false }),
      ]);
      if (pageResult.status === "fulfilled") failurePage = pageResult.value;
      else failures.push(`Failure page capture: ${pageResult.reason}`);
      if (imageResult.status === "fulfilled") image = imageResult.value;
      else failures.push(`Failure screenshot capture: ${imageResult.reason}`);
    }
    records.push({ name: currentScene, pass: false, error: error.message, screenshot: image, failurePage });
    console.error(`Production navigation failed at ${currentScene}:`, error);
  })
  .finally(() => app.quit());

// Exclude only OS protocol association so a test cannot change the user's
// default app. All product startup, windows, preload, IPC and Host stay real.
const loadMain = createRequire(path.join(process.cwd(), "package.json"));
const registerProtocol = app.setAsDefaultProtocolClient;
app.setAsDefaultProtocolClient = () => false;
try {
  loadMain(entry);
} finally {
  app.setAsDefaultProtocolClient = registerProtocol;
}
