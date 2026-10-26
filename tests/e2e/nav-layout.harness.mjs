import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";
import { configureSmokeEnvironment } from "../../src/smoke/environment.ts";
import { longSpaceName } from "../fixtures/nav-sidebar.mjs";

const buildDirectory = path.dirname(fileURLToPath(import.meta.url));
const output = process.env.DEXON_RENDERER_OUT;
if (!output) throw new Error("Native navigation requires an evidence directory");
configureSmokeEnvironment();
let window;
const records = [];
const failures = [];
const js = (code) => window.webContents.executeJavaScript(code, true);
const watchdog = setTimeout(() => {
  console.error("Native navigation check timed out");
  app.exit(1);
}, 60000);
const key = async (keyCode) => {
  await window.webContents.sendInputEvent({ type: "keyDown", keyCode });
  if (keyCode === "Enter") await window.webContents.sendInputEvent({ type: "char", keyCode: "\r" });
  await window.webContents.sendInputEvent({ type: "keyUp", keyCode });
};
async function waitFor(code) {
  await js(`new Promise((resolve,reject)=>{const until=Date.now()+5000; const check=()=>{
    if (${code}) resolve(); else if(Date.now()>=until) reject(new Error('Page condition did not become true: '+${JSON.stringify(code)}));
    else setTimeout(check,20);};check();})`);
}
async function nativeClick(role, name) {
  const target = `window.navLayout.find(${JSON.stringify(role)},${JSON.stringify(name)})`;
  const point = await js(`(() => {
    const element=${target};
    if(!element)throw new Error('Missing control '+${JSON.stringify(`${role}: ${name}`)});
    const r=element.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;
    return {x:Math.round(x),y:Math.round(y)};})()`);
  // Enter from the page canvas rather than relying on the operating system's
  // previous hover target across remounts and screenshot captures.
  await window.webContents.sendInputEvent({ type: "mouseMove", x: 400, y: 10 });
  // Chromium coalesces consecutive moves. Observe the canvas hover before
  // entering the next control so a real leave/enter transition is delivered.
  await waitFor("window.navLayout.main().matches(':hover')");
  await window.webContents.sendInputEvent({ type: "mouseMove", ...point });
  await waitFor(`!!${target}?.contains(document.elementFromPoint(${point.x},${point.y}))`);
  await window.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...point });
  await window.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...point });
}
async function capture(name) {
  await js("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  const image = await window.webContents.capturePage();
  fs.writeFileSync(path.join(output, `${name}.png`), image.toPNG());
  fs.writeFileSync(path.join(output, `${name}-small.png`), image.resize({ width: 640 }).toPNG());
  return `${name}.png`;
}

async function measure(config, name) {
  await js(`window.navLayout.configure(${JSON.stringify(config)})`);
  await measureSessionTree(config, name);
  const measurement = await js(`(() => {
    const {nav,workspace,label,toggle,controls:buttons}=window.navLayout.elements();
    const bounds=r=>({x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom});
    const controls=buttons.filter(({element})=>{const r=element.getBoundingClientRect(),s=getComputedStyle(element);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&parseFloat(s.opacity)>0&&s.pointerEvents!=='none';}).map(({element,label})=>{
      const r=element.getBoundingClientRect();return {label,rect:bounds(r),reachable:element.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};
    });
    return {nav:bounds(nav.getBoundingClientRect()),clientWidth:nav.clientWidth,scrollWidth:nav.scrollWidth,
      documentWidth:document.documentElement.clientWidth,documentScrollWidth:document.documentElement.scrollWidth,
      workspace:workspace?bounds(workspace.getBoundingClientRect()):null,
      label:label?{rect:bounds(label.getBoundingClientRect()),clientWidth:label.clientWidth,scrollWidth:label.scrollWidth,text:label.textContent}:null,
      bodyFont:getComputedStyle(document.body).fontFamily,buttonFont:getComputedStyle(toggle).fontFamily,
      pageBackground:getComputedStyle(document.body).backgroundColor,
      fontFaces:[...document.fonts].map(face=>({family:face.family,status:face.status})),controls};
  })()`);
  assert.ok(
    Math.abs(measurement.nav.width - (config.expanded === false ? 52 : 272)) <= 0.5,
    `${name}: approved navigation width`,
  );
  assert.ok(measurement.scrollWidth <= measurement.clientWidth + 1, `${name}: navigation has no horizontal overflow`);
  assert.ok(
    measurement.documentScrollWidth <= measurement.documentWidth + 1,
    `${name}: page has no horizontal overflow`,
  );
  assert.equal(
    measurement.pageBackground,
    config.theme === "dark" ? "rgb(23, 23, 23)" : "rgb(250, 250, 250)",
    `${name}: the requested theme is actually displayed`,
  );
  assert.ok(measurement.bodyFont.includes("Inter"));
  assert.equal(measurement.buttonFont, measurement.bodyFont, "real controls inherit the production font");
  for (const family of ["Inter", "Geist Mono"])
    assert.ok(
      measurement.fontFaces.some((face) => face.family.replaceAll('"', "") === family && face.status === "loaded"),
    );
  for (const control of measurement.controls) {
    assert.ok(
      control.rect.x >= measurement.nav.x - 1 && control.rect.right <= measurement.nav.right + 1,
      `${name}: ${control.label} stays inside navigation`,
    );
    assert.equal(control.reachable, true, `${name}: ${control.label} is not covered by another element`);
  }
  if (config.spaceName === longSpaceName) {
    assert.equal(measurement.label.text, longSpaceName);
    assert.ok(
      measurement.label.scrollWidth > measurement.label.clientWidth,
      `${name}: long label really exceeds its constrained visible region`,
    );
    assert.ok(
      measurement.label.rect.right <= measurement.nav.right,
      `${name}: long label does not escape the navigation`,
    );
  }
  const screenshot = await capture(name);
  records.push({ name, config, measurement, screenshot, pass: true });
  return measurement;
}

async function run() {
  await app.whenReady();
  window = new BrowserWindow({
    width: 1280,
    height: 760,
    show: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.session.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: /^https?:/.test(details.url) }),
  );
  window.webContents.on("console-message", (event) => {
    if (event.level === "error") failures.push(event.message);
  });
  await window.loadFile(path.join(buildDirectory, "index.html"));
  await js(`window.nativeInputEvents=[]; for(const type of ['mouseover','mouseout','mousemove','mousedown','mouseup']) document.addEventListener(type,event=>{
    window.nativeInputEvents.push({type:event.type,x:event.clientX,y:event.clientY,trusted:event.isTrusted,label:event.target?.getAttribute?.('aria-label'),tag:event.target?.tagName});
    if(window.nativeInputEvents.length>30)window.nativeInputEvents.shift();},true);`);
  // Focus Chromium's page before its keyboard input. OS activation of a CLI
  // window is not the navigation component's contract.
  window.focus();
  window.webContents.focus();
  await waitFor("document.hasFocus()");
  window.setContentSize(1280, 760);
  const short = await measure({ spaceName: "Personal space" }, "01-expanded-short-light");
  const long = await measure({ spaceName: longSpaceName }, "02-expanded-long-light");
  assert.equal(long.workspace.height, short.workspace.height, "a long name does not enlarge the workspace controls");

  window.webContents.focus();
  for (let step = 0; step < 12; step++) {
    await key("Tab");
    if (await js("document.activeElement === window.navLayout.elements().trigger")) break;
  }
  await waitFor("document.activeElement === window.navLayout.elements().trigger");
  const focus = await js(`(() => {const e=document.activeElement,r=e.getBoundingClientRect(),s=getComputedStyle(e);
    return {label:window.navLayout.nameOf(e),hasMenu:e.getAttribute('aria-haspopup'),focusVisible:e.matches(':focus-visible'),outlineWidth:parseFloat(s.outlineWidth),outlineStyle:s.outlineStyle,inside:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};})()`);
  assert.equal(focus.label, `Actions for ${longSpaceName}`);
  assert.equal(focus.hasMenu, "menu");
  assert.equal(focus.focusVisible, true, "real Tab navigation activates visible keyboard focus");
  assert.ok(focus.outlineWidth > 0 && focus.outlineStyle !== "none" && focus.inside);
  records.push({ name: "keyboard-focus", focus, screenshot: await capture("03-keyboard-focus"), pass: true });
  await key("Enter");
  await waitFor("window.navLayout.elements().trigger?.getAttribute('aria-expanded') === 'true'");
  await key("Escape");
  await waitFor("window.navLayout.elements().trigger?.getAttribute('aria-expanded') === 'false'");

  await nativeClick("button", "Hide sidebar");
  await waitFor("!!window.navLayout.find('button','Show sidebar')");
  assert.equal(await js("window.navLayout.elements().nav.getBoundingClientRect().width"), 52);
  await nativeClick("button", "Show sidebar");
  await waitFor("!!window.navLayout.find('button','Hide sidebar')");
  await nativeClick("searchbox", "Search sessions");
  await waitFor("document.activeElement === window.navLayout.find('searchbox','Search sessions')");
  await window.webContents.insertText("beta");
  await waitFor(
    "!!window.navLayout.find('button','beta unrelated') && !window.navLayout.find('button','alpha render bug')",
  );
  await key("Escape");
  await waitFor(
    "window.navLayout.find('searchbox','Search sessions').value === '' && !!window.navLayout.find('button','alpha render bug')",
  );

  await nativeClick("button", "Session actions for alpha render bug");
  await waitFor("!!window.navLayout.find('menuitem','Rename')");
  await nativeClick("menuitem", "Rename");
  await waitFor(
    "document.activeElement === window.navLayout.find('textbox') && document.activeElement.selectionStart === 0 && document.activeElement.selectionEnd === 16",
  );
  const selected = await js(
    "({value:document.activeElement.value,start:document.activeElement.selectionStart,end:document.activeElement.selectionEnd})",
  );
  assert.deepEqual(selected, { value: "alpha render bug", start: 0, end: 16 });
  await window.webContents.insertText("Native renamed conversation");
  await key("Enter");
  await waitFor("!!window.navLayout.find('button','Native renamed conversation')");
  const requests = await js("window.navLayout.snapshot().requests.filter(request=>request.method==='sessions.rename')");
  assert.deepEqual(requests, [
    { method: "sessions.rename", params: { id: "sess-alpha", name: "Native renamed conversation" } },
  ]);
  records.push({
    name: "native-search-and-rename",
    selected,
    requests,
    screenshot: await capture("04-renamed-conversation"),
    pass: true,
  });

  await measure({ expanded: false }, "05-collapsed-light");
  await measure({ scene: "tree" }, "08-session-tree-light");
  window.setContentSize(640, 760);
  await measure({ theme: "dark", language: "zh-CN", spaceName: longSpaceName }, "06-narrow-expanded-dark");
  await measure({ expanded: false, theme: "dark", language: "zh-CN" }, "07-narrow-collapsed-dark");
  assert.deepEqual(failures, [], "the native renderer reports no page errors");
}

function rowsByTitle(rows) {
  return Object.fromEntries(rows.map((row) => [row.name.split(" · ")[0], row]));
}

function assertInside(inner, outer, message) {
  assert.ok(
    inner.x >= outer.x - 1 && inner.right <= outer.right + 1,
    `${message}: ${JSON.stringify(inner)} inside ${JSON.stringify(outer)}`,
  );
}

async function measureSessionTree(config, name) {
  if (config.scene !== "tree" || config.expanded === false) return;
  const rows = await js("window.navLayout.rows()");
  const byTitle = rowsByTitle(rows);
  const folded = byTitle["Release train"];
  const expanded = byTitle["Release notes"];
  const fork = byTitle["Forked release notes"];
  const delegate = byTitle["Delegated release notes"];
  const chain = [
    "Refactor login",
    "Migrate old API",
    "Add API tests",
    "Fix flaky test",
    "Rewrite fixtures",
    "Document migration",
  ].map((title) => byTitle[title]);
  assert.ok(folded && expanded && fork && delegate, `${name}: the folded, expanded, fork and delegate rows render`);
  assert.ok(chain.every(Boolean), `${name}: the six-level chain renders every level`);
  assert.ok(folded.counts, `${name}: the folded parent shows counts`);
  assert.equal(folded.time, null, `${name}: the folded parent trades its relative time for the counts`);
  assert.match(folded.name, /1 waiting for your answer/, `${name}: the folded parent counts the waiting child`);
  assert.match(folded.name, /2 running/, `${name}: the folded parent counts the running children`);
  assert.ok(expanded.time, `${name}: an expanded parent still shows its relative time`);
  assert.equal(expanded.counts, null, `${name}: an expanded parent shows no counts`);
  assert.match(fork.name, /Forked session/, `${name}: the fork child is announced as a fork`);
  assert.match(delegate.name, /Created by session/, `${name}: the delegate child is announced as delegated`);
  assert.ok(!fork.name.includes("Created by session"), `${name}: the two relations are never confused`);
  assert.ok(chain[5].indent > chain[2].indent, `${name}: indent still grows up to the third level`);
  assert.equal(chain[3].indent, chain[5].indent, `${name}: the fourth level stops indenting`);
  assert.ok(chain[5].titleWidth >= 72, `${name}: the sixth level keeps a readable title box`);
  assert.ok(chain[3].titleWidth >= 50, `${name}: the third level keeps a usable title box next to its fold toggle`);
  assertInside(folded.countsBox, folded.rowBox, `${name}: the counts cluster sits inside its row`);
}

async function main() {
  let exitCode = 0;
  try {
    await run();
    console.log(`Native navigation: ${records.length} measured and interactive scenes passed`);
  } catch (error) {
    exitCode = 1;
    failures.push(error.stack ?? String(error));
    console.error(error);
    if (window && !window.isDestroyed()) {
      const diagnostic =
        await js(`(() => {const target=window.navLayout?.find('button','Session actions for alpha render bug');
        return {documentFocused:document.hasFocus(),activeLabel:document.activeElement?.getAttribute('aria-label'),
          actionPresent:!!target,hovered:target?.closest('[role=listitem]')?.matches(':hover'),
          hitLabel:document.elementFromPoint(190,203)?.getAttribute('aria-label'),events:window.nativeInputEvents};})()`).catch(
          () => null,
        );
      console.error("Native input diagnostics", JSON.stringify(diagnostic));
      records.push({ name: "failure-diagnostic", windowFocused: window.isFocused(), diagnostic, pass: false });
      await capture("failure").catch(() => {});
    }
  } finally {
    if (window && !window.isDestroyed()) {
      try {
        await js("window.navLayout?.close()");
      } catch (error) {
        failures.push(error.stack ?? String(error));
        console.error(error);
        exitCode = 1;
      }
      window.destroy();
    }
    fs.writeFileSync(
      process.env.DEXON_ELECTRON_RESULT,
      JSON.stringify(
        {
          completed: exitCode === 0,
          pid: process.pid,
          capturedAt: new Date().toISOString(),
          environment: {
            platform: process.platform,
            arch: process.arch,
            electron: process.versions.electron,
            chromium: process.versions.chrome,
          },
          pass: exitCode === 0,
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

// Electron emits ready only after loading its entry module; do not suspend
// module evaluation on app.whenReady() with a top-level await.
void main();
