import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";
import { configureSmokeEnvironment } from "../../src/smoke/environment.ts";

configureSmokeEnvironment();
const output = process.env.DEXON_RENDERER_OUT;
if (!output) throw new Error("Chat layout requires an evidence directory");
const directory = path.dirname(fileURLToPath(import.meta.url));
const records = [];
const failures = [];
let window;
const js = (source) => window.webContents.executeJavaScript(source, true);
const watchdog = setTimeout(() => app.exit(1), 75_000);
async function waitFor(condition) {
  await js(`new Promise((resolve,reject)=>{const deadline=Date.now()+8000;function check(){
    if(${condition})resolve();else if(Date.now()>deadline)reject(new Error('Unmet page condition: '+${JSON.stringify(condition)}));else setTimeout(check,20);
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
async function key(keyCode) {
  window.webContents.sendInputEvent({ type: "keyDown", keyCode });
  if (keyCode === "Enter") window.webContents.sendInputEvent({ type: "char", keyCode: "\r" });
  window.webContents.sendInputEvent({ type: "keyUp", keyCode });
}
async function configure(config = {}) {
  await js(`window.chatLayout.configure(${JSON.stringify(config)})`);
  await waitFor("!!window.chatLayout.find('textbox') && !document.body.textContent.includes('Loading session...')");
  await paint();
}
async function measurement() {
  return js(`(() => {
    const bounds=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
    const {editor,composer,card,messages,user,assistant,title}=window.chatLayout.elements();
    const center=r=>({x:r.x+r.width/2,y:r.y+r.height/2});
    const reachable=e=>{if(!e)return false;const p=center(e.getBoundingClientRect());return e.contains(document.elementFromPoint(p.x,p.y));};
    return {editor:bounds(editor),composer:bounds(composer),card:card?bounds(card):null,
      messages:messages?bounds(messages):null,
      editorFont:parseFloat(getComputedStyle(editor).fontSize),userFont:user?parseFloat(getComputedStyle(user).fontSize):null,
      assistantFont:assistant?parseFloat(getComputedStyle(assistant).fontSize):null,
      titleFont:title?parseFloat(getComputedStyle(title).fontSize):null,
      reachable:reachable(editor),modal:!!document.querySelector('[aria-modal=true]'),
      pageBackground:getComputedStyle(document.body).backgroundColor,
      documentWidth:document.documentElement.clientWidth,documentScrollWidth:document.documentElement.scrollWidth};
  })()`);
}
function near(actual, expected, message, tolerance = 1) {
  assert.ok(Math.abs(actual - expected) < tolerance, `${message}: ${actual} vs ${expected}`);
}
async function run() {
  await app.whenReady();
  window = new BrowserWindow({
    width: 1440,
    height: 900,
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
  await window.loadFile(path.join(directory, "index.html"));
  window.focus();
  window.webContents.focus();
  await waitFor("document.hasFocus()");
  await configure();
  const standard = await measurement();
  assert.ok(standard.card.bottom <= standard.composer.y + 1, "the real card is visually above the complete composer");
  assert.equal(standard.reachable, true, "the editor is not covered by the card");
  assert.equal(standard.modal, false);
  await js("window.chatLayout.elements().editor.focus()");
  await window.webContents.insertText("Native composer input");
  await waitFor("window.chatLayout.elements().editor.textContent==='Native composer input'");
  await key("Enter");
  await waitFor(
    "window.chatLayout.commands().some(entry=>entry.payload.type==='prompt'&&entry.payload.message==='Native composer input')",
  );
  records.push({ name: "chat-composer", measurement: standard, screenshot: await capture("01-composer"), pass: true });

  for (const [font, scale] of [
    ["small", 0.9],
    ["standard", 1],
    ["large", 1.15],
    ["extra-large", 1.3],
  ]) {
    await configure({ font });
    const value = await measurement();
    near(value.editorFont, 14 * scale, `${font} editor size`, 0.1);
    // The independent preference specification defines these four ratios.
    // Verify scaling precisely, without claiming to validate the transcript's
    // separate underlying typography baseline.
    near(value.userFont / standard.userFont, scale, `${font} user message scaling`, 0.01);
    near(value.assistantFont / standard.assistantFont, scale, `${font} assistant message scaling`, 0.01);
    records.push({ name: `font-${font}`, measurement: value, pass: true });
  }
  for (const [layout, width] of [
    ["fixed", 760],
    ["wide", 960],
  ]) {
    await configure({ layout });
    const value = await measurement();
    // The specified width belongs to the complete panel, not the smaller
    // editable area between its attachment and send controls.
    near(value.composer.width, width, `${layout} input panel width`);
    near(value.messages.width, width, `${layout} transcript width`);
    near(value.card.width, width, `${layout} card width`);
    near(value.card.x, value.composer.x, `${layout} card/input alignment`);
    assert.ok(value.documentScrollWidth <= value.documentWidth + 1);
    records.push({
      name: `width-${layout}`,
      measurement: value,
      screenshot: await capture(`width-${layout}`),
      pass: true,
    });
  }
  await configure({ welcome: true, font: "large" });
  const welcome = await measurement();
  near(welcome.titleFont, 23, "welcome title follows the selected size");
  assert.equal(welcome.reachable, true);
  records.push({ name: "welcome", measurement: welcome, screenshot: await capture("welcome"), pass: true });
  window.setContentSize(640, 900);
  await configure({ layout: "wide", theme: "dark" });
  const narrow = await measurement();
  assert.equal(narrow.pageBackground, "rgb(10, 10, 10)", "the dark scene must actually display the dark page surface");
  assert.ok(narrow.documentScrollWidth <= narrow.documentWidth + 1, "narrow chat does not overflow horizontally");
  assert.equal(narrow.reachable, true);
  assert.ok(narrow.card.bottom <= narrow.composer.y + 1);
  records.push({ name: "narrow-chat", measurement: narrow, screenshot: await capture("narrow-chat"), pass: true });
  assert.deepEqual(failures, [], "the real ChatWindow reports no renderer errors");
}
async function main() {
  let code = 0;
  try {
    await run();
  } catch (error) {
    code = 1;
    failures.push(error.stack ?? String(error));
    console.error(error);
    if (window && !window.isDestroyed()) await capture("failure").catch(() => {});
  } finally {
    if (window && !window.isDestroyed()) {
      try {
        await js("window.chatLayout?.close()");
      } catch (error) {
        code = 1;
        failures.push(String(error));
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
