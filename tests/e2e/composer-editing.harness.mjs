import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, clipboard, nativeImage } from "electron";
import { configureSmokeEnvironment } from "../../src/smoke/environment.ts";

configureSmokeEnvironment();
const output = process.env.DEXON_RENDERER_OUT;
if (!output) throw new Error("Composer editing requires an evidence directory");
const directory = path.dirname(fileURLToPath(import.meta.url));
const records = [];
const failures = [];
let window;
const watchdog = setTimeout(() => app.exit(1), 85_000);

const js = (source) => window.webContents.executeJavaScript(source, true);
const page = (call) => js(`window.composerEditing.${call}`);
const view = () => page("view()");
const sent = () => page("sent()");

async function settle() {
  await js("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  await new Promise((resolve) => setTimeout(resolve, 20));
}
async function waitFor(condition, label, diagnose) {
  const deadline = Date.now() + 5000;
  while (!(await js(`!!(${condition})`))) {
    if (Date.now() > deadline) {
      const detail = diagnose ? ` (${JSON.stringify(await diagnose())})` : "";
      throw new Error(`Unmet page condition: ${label ?? condition}${detail}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
async function key(keyCode, modifiers = []) {
  window.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
  if (keyCode === "Enter") window.webContents.sendInputEvent({ type: "char", keyCode: "\r", modifiers });
  window.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
  await settle();
}
async function press(keyCode, times) {
  for (let index = 0; index < times; index++) await key(keyCode);
}
async function type(text) {
  for (const character of text) window.webContents.sendInputEvent({ type: "char", keyCode: character });
  await settle();
}
async function click({ x, y }) {
  window.webContents.sendInputEvent({ type: "mouseMove", x, y });
  window.webContents.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
  window.webContents.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
  await settle();
}
async function hover({ x, y }) {
  window.webContents.sendInputEvent({ type: "mouseMove", x, y });
  await new Promise((resolve) => setTimeout(resolve, 200));
}
async function menu(action) {
  window.webContents[action]();
  await settle();
}
async function capture(name) {
  await settle();
  const image = await window.webContents.capturePage();
  fs.writeFileSync(path.join(output, `${name}.png`), image.toPNG());
  return `${name}.png`;
}
async function fresh(config = {}) {
  await page(`remount(${JSON.stringify({ draftKey: `composer-${records.length}`, visible: true, ...config })})`);
  await settle();
  await page("focus()");
  await settle();
}
async function scene(name, run) {
  await fresh();
  const evidence = await run();
  records.push({ name, pass: true, ...evidence });
}
function sampleScreenshot() {
  const width = 64;
  const height = 40;
  const pixels = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index++) pixels.set([200, 120, 40, 255], index * 4);
  return nativeImage.createFromBitmap(pixels, { width, height });
}

async function run() {
  await app.whenReady();
  window = new BrowserWindow({
    width: 1000,
    height: 700,
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
  await waitFor("window.composerEditing", "the real composer is mounted");

  await scene("backspace-keeps-attachment", async () => {
    await page(`addFiles([{ name: "shot.png", testPath: "/tmp/shot.png", type: "image/png" }])`);
    await type("hello");
    await key("Backspace");
    assert.deepEqual(await view(), { text: "[shot.png] hell", chips: ["shot.png"], focused: true });
    await press("Left", 2);
    await key("Backspace");
    assert.deepEqual((await view()).text, "[shot.png] hll", "a backspace in the middle removes only one character");
    await type("你好");
    await press("Backspace", 2);
    assert.deepEqual((await view()).text, "[shot.png] hll", "repeated backspace keeps deleting at the caret");
    const screenshot = await capture("01-backspace-keeps-attachment");
    await key("Enter");
    assert.deepEqual(await sent(), ["@/tmp/shot.png hll"]);
    return { screenshot };
  });

  await scene("backspace-at-boundary-removes-attachment-and-undo-restores-it", async () => {
    await type("hi ");
    await page(`addFiles([{ name: "a.ts", testPath: "/tmp/a.ts", type: "text/plain" }])`);
    await type("x");
    await key("Home");
    await key("Delete");
    assert.deepEqual((await view()).chips, ["a.ts"], "forward delete at the start removes the first character");
    await key("End");
    await press("Backspace", 2);
    assert.deepEqual((await view()).chips, ["a.ts"], "the separator goes before the attachment");
    await key("Backspace");
    assert.deepEqual((await view()).chips, [], "a backspace at the attachment boundary removes it whole");
    await menu("undo");
    assert.deepEqual((await view()).chips, ["a.ts"]);
    await key("Enter");
    assert.deepEqual(await sent(), ["i @/tmp/a.ts"]);
  });

  await scene("pasted-screenshot-is-staged-edited-and-sent", async () => {
    clipboard.writeImage(sampleScreenshot());
    await js(
      "document.addEventListener('paste',e=>{window.__pasted=[...e.clipboardData.items].map(i=>i.kind+':'+i.type)},{capture:true,once:true})",
    );
    await menu("paste");
    await waitFor("window.composerEditing.view().chips.length===1", "the staged screenshot appears", async () => ({
      clipboard: clipboard.availableFormats(),
      pasted: await js("window.__pasted ?? null"),
      focused: (await view()).focused,
      staged: await page("staged()"),
      alerts: await page("bannerText()"),
    }));
    const [stage] = await page("staged()");
    assert.equal(stage.ext, "png");
    await type("hello");
    await key("Backspace");
    assert.deepEqual((await view()).text, `[${path.basename(stage.path)}] hell`);
    await key("Enter");
    assert.deepEqual(await sent(), [`@${stage.path} hell`]);
  });

  await scene("inserted-attachment-and-completion-follow-undo-and-redo", async () => {
    await type("see ");
    await page(`addFiles([{ name: "b.md", testPath: "/tmp/b.md", type: "text/markdown" }])`);
    await menu("undo");
    assert.deepEqual(await view(), { text: "see ", chips: [], focused: true });
    await menu("redo");
    assert.deepEqual((await view()).chips, ["b.md"]);
    await type("@src/ma");
    await waitFor("window.composerEditing.hasSuggestion('main.ts')", "the project file is suggested");
    await key("Enter");
    assert.deepEqual((await view()).chips, ["b.md", "main.ts"]);
    assert.deepEqual(await sent(), [], "Enter on a suggestion completes it instead of sending");
    await menu("undo");
    assert.deepEqual((await view()).chips, ["b.md"], "undo returns the completed reference to the typed query");
    await menu("redo");
    await type("now");
    await key("Enter");
    assert.deepEqual(await sent(), ["see @/tmp/b.md @src/main.ts now"]);
  });

  await scene("typed-reference-closes-on-space-and-undo-keeps-it-text", async () => {
    await type("look @src/main.ts ");
    assert.deepEqual((await view()).chips, ["main.ts"]);
    await menu("undo");
    assert.deepEqual(await view(), { text: "look @src/main.ts", chips: [], focused: true });
    await key("End");
    await type("x");
    assert.deepEqual((await view()).chips, [], "typing after undo does not reconvert the reference");
    await key("Backspace");
    await type(' @"my dir/"');
    await key("Left");
    await type(" ");
    assert.deepEqual((await view()).chips, ["main.ts", "my dir"], "a later space closes both references");
    await type("@src/");
    await waitFor("window.composerEditing.hasSuggestion('main.ts')", "the folder is suggested");
    await key("Escape");
    await type(" ");
    assert.deepEqual((await view()).chips, ["main.ts", "my dir", "src"], "a dismissed folder query closes on space");
    await type("hey @hello there");
    await key("Enter");
    assert.deepEqual(await sent(), ['look @src/main.ts @"my dir/" @src/ hey @hello there']);
  });

  await scene("remove-button-and-reveal-act-on-the-attachment", async () => {
    await type("keep ");
    await page(`addFiles([{ name: "c.md", testPath: "/tmp/c.md", type: "text/markdown" }])`);
    await type("this");
    await click(await page(`chipCenter("c.md")`));
    assert.deepEqual(await page("revealed()"), ["/tmp/c.md"]);
    await hover(await page(`chipCenter("c.md")`));
    await click(await page(`removeButtonCenter("c.md")`));
    assert.deepEqual(await view(), { text: "keep this", chips: [], focused: true });
    await menu("undo");
    assert.deepEqual((await view()).chips, ["c.md"]);
    await key("Enter");
    assert.deepEqual(await sent(), ["keep @/tmp/c.md this"]);
  });

  await scene("skills-start-the-message-and-are-replaced-not-stacked", async () => {
    for (const skill of ["fast-context", "groksearch"]) {
      await click(await page(`elementCenter("button", "Add images or local file references")`));
      await waitFor(`window.composerEditing.menuItemCenter("Use a skill")`, "the attachment menu opens");
      await click(await page(`menuItemCenter("Use a skill")`));
      await waitFor(
        `window.composerEditing.menuItemCenter(${JSON.stringify(skill)}, "Use a skill")`,
        "the skill is listed",
      );
      await click(await page(`menuItemCenter(${JSON.stringify(skill)}, "Use a skill")`));
      if (skill === "fast-context") await type("帮我梳理架构");
    }
    assert.deepEqual((await view()).text, "[groksearch] 帮我梳理架构", "a second skill replaces the first");
    await menu("undo");
    assert.deepEqual((await view()).chips, ["fast-context"]);
    await key("Enter");
    assert.deepEqual(await sent(), ["/skill:fast-context 帮我梳理架构"]);
    await type("/skill:fast-context 先读 /skill:groksearch 再说");
    assert.deepEqual((await view()).chips, ["fast-context"], "only the leading command becomes a skill");
    await key("Enter");
    await page(`insertIfEmpty("/skill:groksearch 优化按钮样式")`);
    assert.deepEqual((await view()).chips, ["groksearch"], "inserted content shows its leading skill");
    await page("placeCaretAtEnd()");
    await type("，突出重点");
    await key("Enter");
    assert.deepEqual((await sent()).slice(1), [
      "/skill:fast-context 先读 /skill:groksearch 再说",
      "/skill:groksearch 优化按钮样式，突出重点",
    ]);
  });

  await scene("line-breaks-spaces-and-adjacent-attachments-survive-sending", async () => {
    await type("a  b");
    await key("Enter", ["shift"]);
    await key("Enter", ["shift"]);
    await type("c ");
    await page(
      `addFiles([{ name: "a.ts", testPath: "/a.ts", type: "text/plain" }, { name: "b.ts", testPath: "/b.ts", type: "text/plain" }])`,
    );
    await press("Left", 2);
    await key("Backspace");
    assert.deepEqual((await view()).chips, ["a.ts", "b.ts"]);
    await key("End");
    await type("end");
    await key("Enter");
    assert.deepEqual(await sent(), ["a  b\n\nc @/a.ts @/b.ts end"]);
  });

  await scene("copy-cut-and-paste-carry-full-paths", async () => {
    await type("a ");
    await page(`addFiles([{ name: "my file.ts", testPath: "/x/my file.ts", type: "text/plain" }])`);
    await type("b");
    await page("selectAll()");
    await menu("copy");
    assert.equal(clipboard.readText(), 'a @"/x/my file.ts" b');
    await menu("cut");
    assert.deepEqual((await view()).text, "");
    await menu("undo");
    assert.deepEqual((await view()).chips, ["my file.ts"], "one undo restores the cut selection");
    await page("placeCaretAtEnd()");
    clipboard.writeText(" and @/tmp/d.png\nnext");
    await menu("paste");
    assert.deepEqual((await view()).chips, ["my file.ts", "d.png"]);
    await key("Enter");
    assert.deepEqual(await sent(), ['a @"/x/my file.ts" b and @/tmp/d.png\nnext']);
  });

  await scene("drafts-keep-separate-content-and-history", async () => {
    await type("draft one");
    await page(`configure({ draftKey: "composer-other" })`);
    await settle();
    await page("focus()");
    await type("two");
    await menu("undo");
    await menu("undo");
    assert.deepEqual((await view()).text, "", "undo stays inside the current draft");
    await page(`configure({ draftKey: "composer-${records.length}" })`);
    await settle();
    assert.deepEqual((await view()).text, "draft one");
    await page("sendFails(true)");
    await page("focus()");
    await key("Enter");
    await waitFor("window.composerEditing.view().text==='draft one'", "the failed message is restored");
    await page("sendFails(false)");
    await page(`insertIfEmpty("ignored")`);
    assert.deepEqual((await view()).text, "draft one", "a non-empty draft is not replaced");
  });

  await scene("composition-enter-does-not-send", async () => {
    const debug = window.webContents.debugger;
    debug.attach("1.3");
    try {
      await debug.sendCommand("Input.imeSetComposition", { text: "ni", selectionStart: 2, selectionEnd: 2 });
      await settle();
      window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
      window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
      await settle();
      assert.deepEqual(await sent(), [], "Enter while composing confirms the candidate instead of sending");
      await debug.sendCommand("Input.insertText", { text: "你" });
      await settle();
    } finally {
      debug.detach();
    }
    assert.deepEqual((await view()).text, "你");
    await new Promise((resolve) => setTimeout(resolve, 150));
    await key("Enter");
    assert.deepEqual(await sent(), ["你"]);
  });

  assert.deepEqual(failures, [], "the real composer reports no renderer errors");
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
        await js("window.composerEditing?.close()");
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
