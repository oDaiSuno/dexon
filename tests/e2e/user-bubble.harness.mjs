import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";
import { configureSmokeEnvironment } from "../../src/smoke/environment.ts";

configureSmokeEnvironment();
const output = process.env.DEXON_RENDERER_OUT;
if (!output) throw new Error("The user bubble check requires an evidence directory");
const directory = path.dirname(fileURLToPath(import.meta.url));
const records = [];
const failures = [];
let window;
const watchdog = setTimeout(() => app.exit(1), 85_000);

const SENTENCE_MARKER = "的关系";
const COMMAND_MARKER = "运行下面的命令";
const QUOTED_MARKER = "三者";
const SPECIAL_MARKER = "__init__";
const SKILL_MARKER = "fast-context";
const FROM_SESSION_MARKER = "请把迁移清单做完";
const DELEGATED_MARKER = "请在另一个会话里开始迁移";

const js = (source) => window.webContents.executeJavaScript(source, true);
const page = (call) => js(`window.userBubble.${call}`);

async function settle() {
  await js("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  await new Promise((resolve) => setTimeout(resolve, 20));
}

async function paint() {
  await js(
    "document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))",
  );
}

async function waitFor(condition, label) {
  const deadline = Date.now() + 8000;
  for (;;) {
    if (await js(`!!(${condition})`)) return;
    if (Date.now() > deadline) throw new Error(`Unmet page condition: ${label ?? condition}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
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
  await settle();
}

async function type(value) {
  for (const character of value) window.webContents.sendInputEvent({ type: "char", keyCode: character });
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
  await new Promise((resolve) => setTimeout(resolve, 150));
}

async function show(marker, theme = "light") {
  await page(`configure(${JSON.stringify({ theme })})`);
  await waitFor("!document.body.textContent.includes('Loading session...')", "the session is loaded");
  await waitFor(`!!window.userBubble.layout(${JSON.stringify(marker)}).exists`, `the ${marker} bubble is rendered`);
  await page(`scrollTo(${JSON.stringify(marker)})`);
  await paint();
}

function near(actual, expected, message, tolerance = 0.1) {
  assert.ok(Math.abs(actual - expected) < tolerance, `${message}: ${actual} vs ${expected}`);
}

function verticallyOverlaps(left, right) {
  return left.top < right.bottom && right.top < left.bottom;
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
  window.webContents.on("console-message", (message) => {
    if (message.level === "error") failures.push(message.message);
  });
  await window.loadFile(path.join(directory, "index.html"));
  window.focus();
  window.webContents.focus();
  await waitFor("window.userBubble", "the real chat window is mounted");

  await show(SENTENCE_MARKER);
  {
    const layout = await page(`layout(${JSON.stringify(SENTENCE_MARKER)})`);
    assert.equal(layout.paragraphs.length, 1, "the sentence is a single paragraph");
    const [sentence] = layout.paragraphs;
    assert.equal(sentence.lines, 1, "the sentence occupies one line");
    assert.ok(sentence.rect.height < sentence.lineHeight * 2, "the paragraph is not taller than one line");
    assert.equal(sentence.chips.length, 2, "both attachments are chips inside the sentence");
    const edges = [sentence.textRects[0], sentence.textRects[sentence.textRects.length - 1]];
    for (const chip of sentence.chips) {
      for (const edge of edges) {
        assert.ok(verticallyOverlaps(chip.rect, edge), `the ${chip.label} chip shares the prose line`);
      }
    }
    records.push({
      name: "sentence-with-attachments-stays-on-one-line",
      measurement: layout,
      screenshot: await capture("01-sentence"),
      pass: true,
    });
  }

  await show(COMMAND_MARKER);
  {
    const layout = await page(`layout(${JSON.stringify(COMMAND_MARKER)})`);
    assert.equal(layout.codeBlocks.length, 1, "the fenced command is one complete code block");
    assert.equal(layout.codeBlocks[0].text, "cat @src/a.ts | wc -l", "the code keeps the attachment text verbatim");
    assert.equal(layout.chips.length, 0, "the message shows no attachment chip");
    assert.ok(
      layout.paragraphs.some((paragraph) => paragraph.text.includes("然后告诉我结果")),
      "the closing sentence stays ordinary text",
    );
    assert.ok(!layout.codeBlocks[0].text.includes("然后告诉我结果"), "the code block does not swallow later prose");
    records.push({
      name: "code-block-keeps-attachment-text-verbatim",
      measurement: layout,
      screenshot: await capture("02-code-block"),
      pass: true,
    });
  }

  await show(SPECIAL_MARKER);
  {
    const quoted = await page(`layout(${JSON.stringify(QUOTED_MARKER)})`);
    const special = await page(`layout(${JSON.stringify(SPECIAL_MARKER)})`);
    const chips = [...quoted.chips, ...special.chips];
    const labels = chips.map((chip) => chip.label);
    for (const label of ["report.md", "__init__.py", "a.ts", "b.ts"]) {
      assert.ok(labels.includes(label), `a chip shows the file name ${label}`);
    }
    for (const chip of chips) {
      assert.ok(!chip.label.includes('"'), `the chip for ${chip.label} shows no quote character`);
      assert.ok(!chip.title.includes('"'), `the tooltip for ${chip.title} shows no quote character`);
    }
    records.push({
      name: "special-and-quoted-paths-show-file-names",
      measurement: { quoted, special },
      screenshot: await capture("03-special-paths"),
      pass: true,
    });
  }

  await show(SKILL_MARKER);
  {
    const layout = await page(`layout(${JSON.stringify(SKILL_MARKER)}, "fast-context")`);
    const [paragraph] = layout.paragraphs;
    assert.ok(paragraph, "the skill message shows prose");
    assert.equal(paragraph.lines, 1, "the skill message occupies one line");
    assert.ok(layout.skill, "the skill chip is shown");
    const attachment = paragraph.chips.find((chip) => chip.title === "src/main.ts");
    assert.ok(attachment, "the attachment chip sits in the same paragraph as the prose");
    assert.ok(verticallyOverlaps(layout.skill.rect, paragraph.textRects[0]), "the skill chip shares the prose line");
    assert.ok(verticallyOverlaps(attachment.rect, paragraph.textRects[0]), "the attachment chip shares the prose line");
    records.push({
      name: "skill-and-attachment-chips-share-a-line",
      measurement: layout,
      screenshot: await capture("04-skill-chip"),
      pass: true,
    });
  }

  await show(SENTENCE_MARKER);
  {
    await page("focusComposer()");
    await settle();
    await type("@/tmp/shot.png ");
    await waitFor("!!window.userBubble.composerChipStyle()", "the typed reference becomes a composer chip");
    const composer = await page("composerChipStyle()");
    const bubble = await page(`bubbleChipStyle(${JSON.stringify(SENTENCE_MARKER)}, "/tmp/shot.png")`);
    assert.ok(bubble, "the bubble shows the same attachment as a chip");
    assert.equal(composer.label, "shot.png", "the composer chip shows the file name");
    assert.equal(bubble.label, "shot.png", "the bubble chip shows the file name");
    assert.equal(composer.title, "/tmp/shot.png", "the composer chip keeps the full path in the tooltip");
    assert.equal(bubble.title, "/tmp/shot.png", "the bubble chip keeps the full path in the tooltip");
    near(composer.rect.height, bubble.rect.height, "chip height");
    assert.equal(composer.borderRadius, bubble.borderRadius, "chip corner radius");
    assert.equal(composer.borderWidth, bubble.borderWidth, "chip border width");
    assert.equal(composer.borderStyle, bubble.borderStyle, "chip border style");
    assert.equal(composer.backgroundColor, bubble.backgroundColor, "chip background");
    assert.equal(composer.color, bubble.color, "chip text color");
    near(composer.paddingLeft, bubble.paddingLeft, "chip left padding");
    near(composer.paddingRight, bubble.paddingRight, "chip right padding");
    near(composer.glyph.width, bubble.glyph.width, "chip glyph width");
    near(composer.glyph.height, bubble.glyph.height, "chip glyph height");
    near(bubble.fontSize, bubble.surroundingFontSize * 0.82, "the bubble chip font follows the bubble text");
    near(composer.fontSize, composer.surroundingFontSize * 0.82, "the composer chip font follows the composer text");
    const center = await page(`chipCenter(${JSON.stringify(SENTENCE_MARKER)}, "/tmp/shot.png")`);
    await hover(center);
    const hovered = await page(`bubbleChipStyle(${JSON.stringify(SENTENCE_MARKER)}, "/tmp/shot.png")`);
    near(hovered.rect.width, bubble.rect.width, "hovering the bubble chip reveals no remove control", 1);
    records.push({
      name: "bubble-chip-matches-composer-chip",
      measurement: { composer, bubble, hovered },
      screenshot: await capture("05-chip-appearance"),
      pass: true,
    });
  }

  await show(SENTENCE_MARKER);
  {
    const center = await page(`chipCenter(${JSON.stringify(SENTENCE_MARKER)}, "src/main.ts")`);
    assert.ok(center, "the relative attachment is a clickable chip");
    await click(center);
    assert.deepEqual(await page("revealed()"), ["/workspace/project/src/main.ts"]);
    await page("blurActive()");
    for (let attempt = 0; attempt < 40; attempt++) {
      await key("Tab");
      if ((await page("focusedChipTitle()")) === "/tmp/shot.png") break;
    }
    assert.equal(await page("focusedChipTitle()"), "/tmp/shot.png", "Tab reaches the absolute attachment chip");
    await key("Enter");
    assert.deepEqual(await page("revealed()"), ["/workspace/project/src/main.ts", "/tmp/shot.png"]);
    records.push({
      name: "clicking-a-bubble-chip-reveals-the-file",
      measurement: { clicked: center, focused: "/tmp/shot.png", revealed: await page("revealed()") },
      screenshot: await capture("06-reveal"),
      pass: true,
    });
  }

  await show(FROM_SESSION_MARKER);
  {
    const layout = await page(`sourceChipLayout(${JSON.stringify(FROM_SESSION_MARKER)})`);
    assert.ok(layout.exists, "the message from another session renders");
    assert.ok(layout.chip, "the message names the session it came from");
    assert.equal(layout.chip.label, "From session 委派会话", "the chip names the source session");
    assert.equal(layout.paragraphs.length, 1, "the chip adds no paragraph to the bubble");
    assert.equal(layout.lines, 1, "the prose still occupies a single line");
    const paragraph = layout.paragraphs[0];
    assert.ok(
      layout.chip.rect.bottom <= paragraph.rect.top + 0.5,
      "the chip sits above the prose, outside the paragraph",
    );
    assert.ok(
      !paragraph.text.includes("From session"),
      "the chip text is not part of the paragraph the markdown renderer builds",
    );
    assert.ok(layout.chip.rect.right <= layout.bubble.right + 0.5, "the chip stays inside the bubble");
    records.push({
      name: "message-from-another-session-names-it",
      measurement: layout,
      screenshot: await capture("08-from-session-chip"),
      pass: true,
    });
  }

  await show(DELEGATED_MARKER);
  {
    await js(
      `(() => {const head=[...document.querySelectorAll('button')].find((element)=>element.textContent.includes('Process details')||element.textContent.includes('Processed')); if(head) head.click();})()`,
    );
    await paint();
    const link = await page(`sessionLink("Open session 迁移会话")`);
    assert.ok(link, "the session_new card names the session it created");
    assert.equal(link.text, "迁移会话", "the link shows the target session title");
    assert.ok(link.rect.width > 20 && link.rect.height > 10, "the link is a real visible control");
    await page(`scrollSessionLinkIntoView("Open session 迁移会话")`);
    let center = null;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      await settle();
      const candidate = await page(`sessionLinkCenter("Open session 迁移会话")`);
      if (candidate.hits) {
        center = candidate;
        break;
      }
    }
    assert.ok(center, "the link settles where the user can click it");
    await click(center);
    assert.deepEqual(await page("openRequests()"), ["bubble-target"], "clicking the link asks to open that session");
    records.push({
      name: "tool-card-links-to-the-session-it-created",
      measurement: { link, requested: await page("openRequests()") },
      screenshot: await capture("09-tool-card-link"),
      pass: true,
    });
  }

  {
    const path = await page("breadcrumb()");
    assert.ok(path.exists, "the conversation shows the path that led to it");
    assert.deepEqual(
      path.segments.map((segment) => segment.label),
      ["重构登录模块", "迁移旧接口", "补接口测试"],
      "every ancestor and the current session are named in reading order",
    );
    assert.deepEqual(
      path.segments.map((segment) => segment.current),
      [null, null, "page"],
      "only the session on screen is marked as the current page",
    );
    assert.deepEqual(
      path.segments.map((segment) => segment.tag),
      ["button", "button", "span"],
      "ancestors are buttons and the current step is text",
    );
    assert.ok(path.segments[0].rect.right <= path.segments[1].rect.x + 0.5, "the path starts at the root");
    assert.ok(path.segments[1].rect.right <= path.segments[2].rect.x + 0.5, "the path ends at the current session");
    assert.ok(path.documentScrollWidth <= path.documentWidth + 1, "the path does not overflow the window");
    const root = await page(`breadcrumbCenter("重构登录模块")`);
    await click(root);
    assert.deepEqual(await page("openRequests()"), ["bubble-target", "bulb-root"], "an ancestor opens that session");
    await page(`publishCatalog(["bulb-mid", "bulb-leaf"])`);
    await paint();
    const trimmed = await page("breadcrumb()");
    assert.deepEqual(
      trimmed.segments.map((segment) => segment.label),
      ["迁移旧接口", "补接口测试"],
      "a deleted ancestor and its title leave the path",
    );
    await page(`publishCatalog(["bulb-root", "bulb-mid", "bulb-leaf"])`);
    await page("clearCatalog()");
    await paint();
    const cleared = await page("breadcrumb()");
    assert.equal(cleared.exists, false, "an empty catalog leaves no stale path");
    await page(`publishCatalog(["bulb-root", "bulb-mid", "bulb-leaf"])`);
    await paint();
    records.push({
      name: "session-path-names-and-opens-ancestors",
      measurement: { path, trimmed, cleared, requested: await page("openRequests()") },
      screenshot: await capture("10-session-path"),
      pass: true,
    });
  }

  await show(SENTENCE_MARKER, "dark");
  {
    await page(`scrollTo(${JSON.stringify(COMMAND_MARKER)})`);
    await paint();
    const layout = await page("page()");
    assert.equal(layout.pageBackground, "rgb(10, 10, 10)", "the dark scene actually displays the dark page surface");
    assert.ok(layout.documentScrollWidth <= layout.documentWidth + 1, "the bubbles do not overflow horizontally");
    const sentence = await page(`layout(${JSON.stringify(SENTENCE_MARKER)})`);
    const command = await page(`layout(${JSON.stringify(COMMAND_MARKER)})`);
    records.push({
      name: "dark-theme-bubble",
      measurement: { page: layout, sentence: sentence.chips, command: command.codeBlocks },
      screenshot: await capture("07-dark"),
      pass: true,
    });
  }

  assert.deepEqual(failures, [], "the real chat window reports no renderer errors");
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
        await js("window.userBubble?.close()");
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
