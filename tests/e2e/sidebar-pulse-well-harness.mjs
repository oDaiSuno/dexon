import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";
import { configureSmokeEnvironment } from "../../src/smoke/environment.ts";
import { verifyManyRoots } from "./sidebar-pulse-well-overflow.mjs";

configureSmokeEnvironment();
const directory = path.dirname(fileURLToPath(import.meta.url));
const output = process.env.DEXON_RENDERER_OUT;
const records = [];
const failures = [];
let window;
const js = (code) => window.webContents.executeJavaScript(code, true);
const watchdog = setTimeout(() => app.exit(1), 70_000);
async function waitFor(code) {
  await js(
    `new Promise((resolve,reject)=>{const end=Date.now()+8000;const check=()=>{if(${code})resolve();else if(Date.now()>end)reject(new Error('Page condition: '+${JSON.stringify(code)}));else setTimeout(check,20)};check()})`,
  );
}
async function point(scope, role, name) {
  return js(
    `(() => {const element=window.pulseProof.find(${JSON.stringify(scope)},${JSON.stringify(role)},${JSON.stringify(name)});const r=element.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`,
  );
}
async function move(scope, role, name) {
  const at = await point(scope, role, name);
  window.webContents.sendInputEvent({ type: "mouseMove", ...at });
  return at;
}
async function click(scope, role, name) {
  const at = await move(scope, role, name);
  await waitFor(
    `window.pulseProof.find(${JSON.stringify(scope)},${JSON.stringify(role)},${JSON.stringify(name)}).contains(document.elementFromPoint(${at.x},${at.y}))`,
  );
  window.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...at });
  window.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...at });
  await js("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
}
async function capture(name, observation, pass = true) {
  await js("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  const image = await window.webContents.capturePage();
  fs.writeFileSync(path.join(output, `${name}.png`), image.toPNG());
  fs.writeFileSync(path.join(output, `${name}-small.png`), image.resize({ width: 640 }).toPNG());
  const size = image.getSize();
  const scale = size.width / window.getContentSize()[0];
  const sidebar = image.crop({ x: 0, y: 0, width: Math.min(size.width, Math.round(272 * scale)), height: size.height });
  fs.writeFileSync(path.join(output, `${name}-sidebar.png`), sidebar.toPNG());
  records.push({ name, pass, observation, screenshot: `${name}.png` });
}
async function revealed(name) {
  await waitFor("window.pulseProof.targetState().visible && window.pulseProof.targetState().selected");
  const unhovered = await js("window.pulseProof.targetState()");
  assertHistoryState(unhovered);
  if (name === "first-reveal") {
    await move("target", "button", { pattern: "^pulse-urgent" });
    await waitFor("window.pulseProof.targetState().reservedActions === 28");
  }
  const state = await js("window.pulseProof.targetState()");
  assertHistoryState(state);
  await capture(name, { ...state, unhovered });
}
function assertHistoryState(state) {
  assert.ok(
    state.historyScrollWidth <= state.historyClientWidth + 1,
    `History has no horizontal overflow: ${JSON.stringify(state)}`,
  );
  assert.equal(state.scrollLeft, 0, "revealing the target never needs horizontal navigation");
  assert.ok(state.titleWidth >= 48, `the revealed waiting session keeps a readable title: ${state.titleWidth}px`);
  for (const part of state.parts)
    assert.ok(
      part.x >= state.row.x - 0.5 &&
        part.right <= state.row.right + 0.5 &&
        part.x >= state.history.x - 0.5 &&
        part.right <= state.history.x + state.historyClientWidth + 0.5,
      `revealed session content stays inside History: ${JSON.stringify({ part, row: state.row, history: state.history })}`,
    );
  assert.equal(state.projectOpen, "true");
  assert.equal(state.folded, 0);
  assert.ok(state.scrollTop > 0, "real history scrolled to the urgent descendant");
  assert.equal(state.statusName, "Waiting for your answer");
  assert.ok(
    state.status.x >= state.row.x && state.status.right <= state.row.right,
    "own waiting pill stays inside the revealed row",
  );
}
function assertWellRows(measurement) {
  for (const row of measurement.wellRows.filter((item) => item.parts)) {
    for (const [name, part] of Object.entries(row.parts)) {
      if (!part) continue;
      assert.ok(
        part.x >= row.row.x - 0.5 &&
          part.right <= row.row.right + 0.5 &&
          part.y >= row.row.y - 0.5 &&
          part.bottom <= row.row.bottom + 0.5,
        `${row.name}: ${name} stays inside its row: ${JSON.stringify({ part, row: row.row })}`,
      );
    }
    for (const part of row.prefixChildren)
      assert.ok(
        part.x >= row.parts.prefix.x - 0.5 && part.right <= row.parts.prefix.right + 0.5,
        `${row.name}: prefix text and slash cannot paint over the title: ${JSON.stringify({ part, prefix: row.parts.prefix })}`,
      );
    assert.ok(
      row.trailingScrollWidth <= row.trailingClientWidth + 1,
      `${row.name}: trailing status text remains fully visible without clipping`,
    );
    assert.ok(
      row.titleWidth >= 56,
      `${row.name}: root title keeps at least 56px of usable width, received ${row.titleWidth}px`,
    );
  }
}

async function run() {
  await app.whenReady();
  window = new BrowserWindow({
    width: 1280,
    height: 760,
    show: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  window.webContents.on("console-message", (event) => {
    if (event.level === "error") failures.push(event.message);
  });
  window.webContents.session.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: /^https?:/.test(details.url) }),
  );
  await window.loadFile(path.join(directory, "index.html"));
  window.focus();
  window.webContents.focus();
  await waitFor("window.pulseProof?.ready()");
  await js("document.fonts.ready");
  await js("window.pulseProof.start()");
  await waitFor("!!document.querySelector('section[aria-label=\"Active sessions\"]')");
  const expanded = await js("window.pulseProof.measurements()");
  assert.deepEqual(
    expanded.wellRows.map((row) => row.height),
    [22, 28, 28, 28],
  );
  assertWellRows(expanded);
  await click("well", "button", "Collapse active sessions");
  await move("history", "button", "navigation-project");
  await waitFor("window.pulseProof.measurements().moreOpacity === 1 && window.pulseProof.measurements().moreReachable");
  const summary = await js("window.pulseProof.measurements()");
  assert.equal(summary.summary.height, 28);
  assert.equal(summary.summaryBorder, summary.warningBorder);
  assert.match(summary.summaryDescription, /1 waiting for your answer.*navigation-project.*paper-notes/);
  assert.equal(summary.summaryTooltip, summary.summaryDescription);
  assert.ok(summary.summaryNames.width >= 80, "compact English counts leave readable space for project names");
  assert.equal(summary.projectLabel, "navigation-project");
  assert.ok(summary.badge.right < summary.more.x, "waiting badge remains left of the real more button");
  await capture("summary-and-hover", { expanded, ...summary });
  await click("well", "button", { pattern: "Expand active sessions" });
  await click("well", "button", { pattern: "pulse-root" });
  await revealed("first-reveal");
  await js("window.pulseProof.fold('pulse-middle'); window.pulseProof.fold('pulse-root')");
  await js("window.pulseProof.scrollAway()");
  await click("history", "button", "navigation-project");
  await waitFor("!window.pulseProof.targetState().present");
  await click("well", "button", { pattern: "pulse-root" });
  await revealed("repeat-after-refold");
  await js("window.pulseProof.scrollAway()");
  assert.equal((await js("window.pulseProof.targetState()")).visible, false);
  await click("well", "button", { pattern: "pulse-root" });
  await revealed("repeat-after-scroll");
  await js("window.pulseProof.shortPrefix()");
  await waitFor("!!window.pulseProof.find('well','button','Show all active tasks')");
  await click("well", "button", "Show all active tasks");
  const short = await js("window.pulseProof.measurements()");
  assertWellRows(short);
  const shortRow = short.wellRows.find((row) => row.prefixName === "api");
  assert.ok(shortRow, "the real App renders the short-prefix project task");
  assert.equal(
    shortRow.prefixNameWidth,
    shortRow.prefixNameScrollWidth,
    "short project names preserve their natural width without ellipsis",
  );
  assert.match(shortRow.tooltip, /api \/ Short project task/);
  await capture("short-prefix", short);
  await click("navigation", "button", "Hide sidebar");
  await waitFor("window.pulseProof.rail().width === 52");
  const rail = await js("window.pulseProof.rail()");
  assert.equal(rail.buttons, 4);
  assert.equal(rail.dot, true);
  assert.match(rail.status, /1 waiting for your answer/);
  await capture("rail", rail);
  await verifyManyRoots({
    js,
    assertWellRows,
    click,
    waitFor,
    capture,
    resize: async (width, height) => window.setSize(width, height),
    wheel: async (at, deltaY) => {
      window.webContents.sendInputEvent({
        type: "mouseWheel",
        x: Math.round(at.x),
        y: Math.round(at.y),
        deltaX: 0,
        deltaY,
        canScroll: true,
        hasPreciseScrollingDeltas: true,
      });
      await js("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    },
  });
  assert.deepEqual(await js("window.pulseProof.unexpected()"), []);
  assert.deepEqual(failures, []);
}
async function main() {
  let exitCode = 0;
  try {
    await run();
    console.log(`Sidebar pulse well: ${records.length} native scenes passed`);
  } catch (error) {
    exitCode = 1;
    failures.push(error.stack ?? String(error));
    console.error(error);
    if (window && !window.isDestroyed()) {
      await capture(
        "failure",
        await js(
          "({text: document.body.innerText, measurement: window.pulseProof.measurements(), overflow: window.pulseProof.overflowState()})",
        ).catch(() => null),
        false,
      ).catch(() => {});
    }
  } finally {
    if (window && !window.isDestroyed()) {
      await js("window.pulseProof?.close()").catch((error) => {
        failures.push(String(error));
        exitCode = 1;
      });
      window.destroy();
    }
    fs.writeFileSync(
      process.env.DEXON_ELECTRON_RESULT,
      JSON.stringify(
        {
          completed: exitCode === 0,
          pass: exitCode === 0,
          pid: process.pid,
          capturedAt: new Date().toISOString(),
          environment: {
            platform: process.platform,
            arch: process.arch,
            electron: process.versions.electron,
            chromium: process.versions.chrome,
          },
          records,
          failures,
        },
        null,
        2,
      ),
    );
    clearTimeout(watchdog);
    app.exit(exitCode);
  }
}
void main();
