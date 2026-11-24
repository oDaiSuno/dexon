import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain, Menu, nativeImage } from "electron";
import { installAppMenu } from "../../src/main/menu.ts";
import { configureSmokeEnvironment } from "../../src/smoke/environment.ts";

configureSmokeEnvironment();
const output = process.env.DEXON_RENDERER_OUT;
if (!output) throw new Error("Image zoom requires an evidence directory");
const directory = path.dirname(fileURLToPath(import.meta.url));
const fixtures = fs.mkdtempSync(path.join(os.tmpdir(), "dexon-image-zoom-"));
const records = [];
const failures = [];
let window;
let watcher;
let delayedRead = null;
let readStarted = null;
const watchdog = setTimeout(() => app.exit(1), 110_000);
const js = (source) => window.webContents.executeJavaScript(source, true);
const page = (source) => js(`window.imageZoom.${source}`);
const state = (index = 0) => page(`state(${index})`);
const near = (actual, expected, tolerance = 0.01) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected} (±${tolerance})`);
const framing = (actual, expected) => {
  near(actual.scale, expected.scale);
  near(actual.x, expected.x);
  near(actual.y, expected.y);
};

function png(width, height, variant = 0) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const grid = x % 100 < 3 || y % 100 < 3;
      pixels[offset] = grid ? 32 : (x + variant * 31) % 256;
      pixels[offset + 1] = grid ? 32 : y % 256;
      pixels[offset + 2] = grid ? 32 : 190;
      pixels[offset + 3] = 255;
    }
  }
  return nativeImage.createFromBitmap(pixels, { width, height, scaleFactor: 1 }).toPNG();
}
const A = path.join(fixtures, "A.png");
const B = path.join(fixtures, "B.png");
const longName = path.join(fixtures, "A-very-long-image-preview-name-that-needs-ellipsis.png");
const tiny = path.join(fixtures, "tiny.png");
const vector = path.join(fixtures, "vector.svg");

async function settle() {
  await js("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  await new Promise((resolve) => setTimeout(resolve, 35));
}

async function waitFor(condition) {
  const deadline = Date.now() + 6000;
  while (!(await js(`Boolean(${condition})`))) {
    if (Date.now() > deadline)
      throw new Error(`Page condition did not become true: ${condition}; ${JSON.stringify(await state())}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  await settle();
}

function focus() {
  app.focus({ steal: true });
  window.focus();
  window.webContents.focus();
}
function input(event) {
  window.webContents.sendInputEvent(event);
}
async function click(point, count = 1) {
  focus();
  const x = Math.round(point.x);
  const y = Math.round(point.y);
  input({ type: "mouseMove", x, y });
  input({ type: "mouseDown", x, y, button: "left", clickCount: count });
  input({ type: "mouseUp", x, y, button: "left", clickCount: count });
  await settle();
}
async function button(label, index = 0) {
  await click(await page(`button(${JSON.stringify(label)}, ${index})`));
}
const center = (s) => ({ x: Math.round(s.stage.x + s.stage.width / 2), y: Math.round(s.stage.y + s.stage.height / 2) });
async function double(index = 0) {
  await click(center(await state(index)), 2);
}
async function wheel(point, deltaY, control = false) {
  focus();
  input({ type: "mouseMove", x: Math.round(point.x), y: Math.round(point.y) });
  input({
    type: "mouseWheel",
    x: Math.round(point.x),
    y: Math.round(point.y),
    deltaY,
    deltaX: 0,
    modifiers: control ? ["control"] : [],
    canScroll: true,
  });
  await settle();
}
async function drag(start, end, release = true) {
  focus();
  input({ type: "mouseMove", x: Math.round(start.x), y: Math.round(start.y) });
  input({ type: "mouseDown", x: Math.round(start.x), y: Math.round(start.y), button: "left", clickCount: 1 });
  for (let step = 1; step <= 8; step += 1) {
    input({
      type: "mouseMove",
      x: Math.round(start.x + ((end.x - start.x) * step) / 8),
      y: Math.round(start.y + ((end.y - start.y) * step) / 8),
      modifiers: ["leftButtonDown"],
    });
    await settle();
  }
  if (release) input({ type: "mouseUp", x: Math.round(end.x), y: Math.round(end.y), button: "left", clickCount: 1 });
  await settle();
}
async function key(keyCode) {
  focus();
  const modifiers = [process.platform === "darwin" ? "meta" : "control"];
  input({ type: "keyDown", keyCode, modifiers });
  input({ type: "keyUp", keyCode, modifiers });
  await settle();
}
async function capture(name) {
  const file = `${name}.png`;
  fs.writeFileSync(path.join(output, file), (await window.webContents.capturePage()).toPNG());
  return file;
}
async function load(file = A) {
  await page(`load(${JSON.stringify(file)})`);
  await waitFor("window.imageZoom.state()?.ready");
  await button("Reset to fit");
  return state();
}
async function primitives(entries) {
  await page(`primitives(${JSON.stringify(entries)})`);
  await waitFor("window.imageZoom.state()?.ready");
}
async function changed(bytes, width, height) {
  const before = await state();
  fs.writeFileSync(A, bytes);
  await waitFor(
    `window.imageZoom.state()?.src !== ${JSON.stringify(before.src)} && window.imageZoom.state()?.ready && window.imageZoom.state()?.naturalWidth === ${width} && window.imageZoom.state()?.naturalHeight === ${height}`,
  );
  return state();
}
async function scene(name, run) {
  const measurement = {};
  try {
    await run(measurement);
    records.push({ name, pass: true, measurement, screenshot: await capture(name) });
    console.log(`[image-zoom] ${name}: pass ${JSON.stringify(measurement)}`);
  } catch (error) {
    failures.push({ scene: name, error: error.stack ?? String(error) });
    records.push({ name, pass: false, measurement, error: String(error) });
    console.error(`[image-zoom] ${name}: FAIL ${error.stack ?? error}`);
    await capture(`failure-${name}`);
  }
}

async function run() {
  await app.whenReady();
  fs.writeFileSync(A, png(1200, 900));
  fs.writeFileSync(B, png(800, 600));
  fs.copyFileSync(A, longName);
  fs.writeFileSync(tiny, png(64, 64));
  fs.writeFileSync(
    vector,
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 900"><path fill="gold" d="M0 0H1200V900H0Z"/><circle cx="600" cy="450" r="100" fill="navy"/></svg>',
  );
  const preload = path.join(directory, "image-preload.cjs");
  fs.writeFileSync(
    preload,
    `const { contextBridge, ipcRenderer } = require("electron"); contextBridge.exposeInMainWorld("imageFiles", { read: file => ipcRenderer.invoke("image.read", file), onChange: listener => { const receive = (_event, file) => listener(file); ipcRenderer.on("image.changed", receive); return () => ipcRenderer.removeListener("image.changed", receive); } });`,
  );
  ipcMain.handle("image.read", async (_event, file) => {
    if (path.dirname(file) !== fixtures) throw new Error("File escaped fixture directory");
    const bytes = fs.readFileSync(file);
    if (delayedRead) {
      const delay = delayedRead;
      delayedRead = null;
      readStarted?.();
      readStarted = null;
      await delay;
    }
    return {
      content: bytes.toString("base64"),
      encoding: "base64",
      mime: file.endsWith(".svg") ? "image/svg+xml" : "image/png",
      size: bytes.length,
    };
  });
  window = new BrowserWindow({
    width: 1280,
    height: 900,
    show: true,
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  installAppMenu(() => window);
  watcher = fs.watch(fixtures, (_event, name) => {
    if (name && !window.isDestroyed()) window.webContents.send("image.changed", path.join(fixtures, String(name)));
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.session.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: /^https?:/.test(details.url) }),
  );
  window.webContents.on("console-message", (event) => {
    if (event.level === "error") failures.push({ scene: "renderer", error: event.message });
  });
  await window.loadFile(path.join(directory, "index.html"));
  focus();
  await waitFor("window.imageZoom");

  await scene("wheel-and-control-wheel-anchor-without-window-zoom", async (m) => {
    await load();
    await double();
    for (const control of [false, true]) {
      const before = await state();
      const point = { x: before.stage.x + 230, y: before.stage.y + 260 };
      await wheel(point, control ? 20 : 60, control);
      const after = await state();
      assert.ok(after.scale > before.scale, "upward wheel magnifies the image");
      const local = { x: point.x - before.stage.x, y: point.y - before.stage.y };
      near(after.x + ((local.x - before.x) / before.scale) * after.scale, local.x, 1);
      near(after.y + ((local.y - before.y) / before.scale) * after.scale, local.y, 1);
      near(window.webContents.getZoomFactor(), 1);
      near(after.viewportScale, before.viewportScale);
      assert.deepEqual(after.ancestorScroll, before.ancestorScroll);
      m[control ? "pinch" : "wheel"] = { before, after };
    }
  });

  await scene("drag-capture-threshold-and-release", async (m) => {
    await load();
    await double();
    const before = await state();
    const start = center(before);
    await drag(start, { x: start.x + 1, y: start.y + 1 });
    framing(await state(), before);
    await double();
    near((await state()).scale, 500 / 1200);
    await double();
    const actual = await state();
    const end = { x: actual.stage.right + 35, y: start.y + 40 };
    await drag(start, end, false);
    const during = await state();
    assert.ok(during.x > actual.x + 100, "capture continues outside the stage");
    input({ type: "mouseUp", x: Math.round(end.x), y: Math.round(end.y), button: "left", clickCount: 1 });
    await settle();
    input({ type: "mouseMove", x: start.x, y: start.y });
    await settle();
    framing(await state(), during);
    assert.equal((await state()).nativeDrags, 0);
    m.during = during;
  });

  await scene("double-click-actual-and-small-image", async (m) => {
    const fit = await load();
    await double();
    near((await state()).scale, 1);
    await double();
    framing(await state(), fit);
    await load(tiny);
    await double();
    near((await state()).scale, 2);
    m.tinyMagnified = await state();
    await double();
    near((await state()).scale, 1);
    m.tiny = await state();
  });

  await scene("buttons-stops-limits-and-native-shortcuts", async (m) => {
    const fit = await load();
    await button("Zoom in");
    near((await state()).scale, 0.5);
    await button("Zoom out");
    framing(await state(), fit);
    for (const expected of [0.5, 0.75, 1]) {
      await button("Zoom in");
      near((await state()).scale, expected);
    }
    await button("Reset to fit");
    framing(await state(), fit);
    for (let i = 0; i < 16; i += 1) await button("Zoom in");
    let current = await state();
    near(current.scale, 16);
    assert.equal(current.controls.find((c) => c.label === "Zoom in").disabled, true);
    await wheel(center(current), 100, true);
    near((await state()).scale, 16);
    for (let i = 0; i < 20; i += 1) await button("Zoom out");
    current = await state();
    near(current.scale, 0.05);
    assert.equal(current.controls.find((c) => c.label === "Zoom out").disabled, true);
    for (const keyCode of ["+", "-", "0"]) await key(keyCode);
    const shortcuts = await page("shortcuts()");
    for (const shortcut of shortcuts) {
      assert.equal(shortcut.prevented, false);
      assert.equal(shortcut[process.platform === "darwin" ? "meta" : "control"], true);
    }
    const menu = Menu.getApplicationMenu().items.find((item) => item.label === "View").submenu;
    const nativeRole = (name) => {
      const item = menu.items.find((entry) => entry.role?.toLowerCase() === name.toLowerCase());
      assert.ok(item, `The shipped menu exposes ${name}`);
      item.click({ triggeredByAccelerator: true }, window, window.webContents);
    };
    nativeRole("resetZoom");
    await settle();
    nativeRole("zoomIn");
    await settle();
    assert.ok(window.webContents.getZoomFactor() > 1);
    m.nativeZoom = window.webContents.getZoomFactor();
    nativeRole("zoomOut");
    await settle();
    near(window.webContents.getZoomFactor(), 1);
    nativeRole("zoomIn");
    nativeRole("resetZoom");
    await settle();
    near(window.webContents.getZoomFactor(), 1);
    m.shortcuts = shortcuts;
    m.minimum = current.scale;
  });

  await scene("narrow-and-wide-header", async (m) => {
    await load(longName);
    await page("resize(280)");
    await settle();
    const narrow = await state();
    assert.ok(narrow.headerScrollWidth <= narrow.headerWidth);
    assert.equal(narrow.secondary, "none");
    assert.ok(narrow.path.width >= 48);
    assert.ok(narrow.path.scrollWidth > narrow.path.width);
    assert.equal(narrow.path.overflow, "ellipsis");
    for (const control of narrow.controls) {
      assert.ok(control.rect.left >= narrow.header.left && control.rect.right <= narrow.header.right, control.label);
      assert.ok(control.rect.top >= narrow.header.top && control.rect.bottom <= narrow.header.bottom, control.label);
    }
    m.narrowScreenshot = await capture("header-280px");
    await page("resize(480)");
    await settle();
    const wide = await state();
    assert.notEqual(wide.secondary, "none");
    m.narrow = narrow;
    m.wide = wide;
  });

  await scene("collapsed-dock-preserves-framing", async (m) => {
    await load();
    await double();
    const start = center(await state());
    await drag(start, { x: start.x - 50, y: start.y - 30 });
    const before = await state();
    for (let i = 0; i < 4; i += 1) {
      await page("resize(0)");
      await settle();
      assert.ok(!/NaN|Infinity/.test((await state()).transform));
      await page("resize(532)");
      await settle();
      framing(await state(), before);
    }
    m.restored = await state();
  });

  await scene("tabs-remember-and-environments-isolate", async (m) => {
    await load();
    await double();
    const start = center(await state());
    await drag(start, { x: start.x - 40, y: start.y - 25 });
    const remembered = await state();
    await load(B);
    await page(`load(${JSON.stringify(A)})`);
    await waitFor("window.imageZoom.state()?.ready");
    framing(await state(), remembered);
    await button("Zoom in");
    const local = await state();
    await page(`load(${JSON.stringify(A)}, "remote-fixture")`);
    await waitFor("window.imageZoom.state()?.ready");
    near((await state()).scale, 500 / 1200);
    await page(`load(${JSON.stringify(A)}, "primary")`);
    await waitFor("window.imageZoom.state()?.ready");
    framing(await state(), local);
    m.remembered = remembered;
    m.local = local;
  });

  await scene("hot-reload-keeps-nodes-and-framing", async (m) => {
    await load();
    await double();
    const start = center(await state());
    await drag(start, { x: start.x - 40, y: start.y - 25 });
    const before = await state();
    await page("beginProbe()");
    const same = await changed(png(1200, 900, 1), 1200, 900);
    framing(same, before);
    const higher = await changed(png(2400, 1800), 2400, 1800);
    near(higher.scale, before.scale / 2);
    near(higher.x, before.x);
    near(higher.y, before.y);
    const aspect = await changed(png(900, 1200), 900, 1200);
    near(aspect.scale, 500 / 1200);
    near(aspect.x, 78.5);
    near(aspect.y, 16);
    const probe = await page("endProbe()");
    assert.deepEqual(probe, { loading: 0, hidden: 0, replaced: false });
    m.probe = probe;
    m.same = same;
    m.higher = higher;
    m.aspect = aspect;
    await changed(png(1200, 900), 1200, 900);
  });

  await scene("corrupt-image-recovers-and-latest-load-wins", async (m) => {
    await load();
    await double();
    const before = await state();
    fs.writeFileSync(A, "not an image");
    await waitFor("window.imageZoom.state()?.error === 'Failed to load image'");
    m.errorScreenshot = await capture("corrupt-image-feedback");
    const repaired = await changed(png(1200, 900, 2), 1200, 900);
    framing(repaired, before);
    assert.equal(repaired.error, null);
    let release;
    delayedRead = new Promise((resolve) => {
      release = resolve;
    });
    const started = new Promise((resolve) => {
      readStarted = resolve;
    });
    fs.writeFileSync(A, png(800, 600));
    await Promise.race([
      started,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Delayed fixture read did not start")), 6000)),
    ]);
    const pending = changed(png(1600, 1200, 3), 1600, 1200);
    await settle();
    release();
    await pending;
    await settle();
    await settle();
    const latest = await state();
    assert.equal(latest.naturalWidth, 1600);
    assert.equal(latest.error, null);
    near(latest.scale, 0.75);
    m.latest = latest;
    await changed(png(1200, 900), 1200, 900);
  });

  await scene("viewbox-svg-zoom", async (m) => {
    await load(vector);
    await double();
    const before = await state();
    await wheel(center(before), 60);
    const after = await state();
    assert.ok(after.scale > before.scale);
    near(after.x + ((266 - before.x) / before.scale) * after.scale, 266, 1);
    near(after.y + ((266 - before.y) / before.scale) * after.scale, 266, 1);
    assert.ok(after.naturalWidth > 0 && after.naturalHeight > 0);
    m.svg = after;
  });

  await scene("shared-key-last-input-wins-not-resize-or-unmount", async (m) => {
    const filePath = "two-live-instances.png";
    await primitives([
      { id: "old", filePath },
      { id: "recent", filePath },
    ]);
    await button("Zoom in", 0);
    await button("Zoom in", 1);
    await button("Zoom in", 1);
    const recent = await state(1);
    await page("resize(280, 0)");
    await settle();
    await primitives([{ id: "recent", filePath }]);
    await primitives([{ id: "new", filePath }]);
    framing(await state(), recent);
    m.restored = await state();
  });

  await scene("strict-mode-and-detached-listeners", async (m) => {
    await load();
    await double();
    const before = await state();
    await wheel(center(before), 60);
    const after = await state();
    const delta = after.deltas.at(-1);
    assert.equal(delta.ctrlKey, false);
    near(after.scale, before.scale * Math.exp(-Math.max(-160, Math.min(160, delta.deltaY)) * 0.0022), 0.00001);
    await page("detach()");
    await wheel(center(before), 60);
    await waitFor("window.imageZoom.detachedWheel() !== null");
    m.unmountedWheel = await page("detachedWheel()");
    assert.equal(m.unmountedWheel.prevented, false);
    assert.ok(m.unmountedWheel.deltaY < 0);
    await load();
    await double();
    const fresh = await state();
    await wheel(center(fresh), 60);
    const next = await state();
    near(next.scale, fresh.scale * Math.exp(-next.deltas.at(-1).deltaY * 0.0022), 0.00001);
    m.delta = delta;
    m.once = next.scale;
  });
  assert.deepEqual(failures, []);
}

async function main() {
  let code = 0;
  try {
    await run();
  } catch (error) {
    code = 1;
    failures.push({ scene: "suite", error: error.stack ?? String(error) });
    console.error(error);
  } finally {
    watcher?.close();
    if (window && !window.isDestroyed()) {
      try {
        await page("close()");
      } catch (error) {
        code = 1;
        failures.push({ scene: "cleanup", error: String(error) });
      }
      window.destroy();
    }
    ipcMain.removeHandler("image.read");
    fs.rmSync(fixtures, { recursive: true, force: true });
    fs.writeFileSync(
      process.env.DEXON_ELECTRON_RESULT,
      JSON.stringify(
        {
          completed: code === 0,
          pass: code === 0,
          pid: process.pid,
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
