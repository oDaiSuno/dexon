import assert from "node:assert/strict";
import test, { after } from "node:test";
import { accessibleName, allByRole } from "../support/dom-queries.mjs";
import { click, dom, loadRenderer, mount, restoreGlobals, text, waitFor } from "../support/renderer.mjs";
import { installRendererApi } from "../support/renderer-api.mjs";

const api = await loadRenderer(
  "user-bubble-chips",
  'export {MessageView} from "./src/renderer/components/MessageView.tsx";',
);
api.setAppLanguage("en-US");
after(restoreGlobals);

const CWD = "/workspace/project";
const SENTENCE = "看一下 @/tmp/shot.png 和 @src/main.ts 的关系";

const nameOf = (element) => accessibleName(element) || element.getAttribute("title") || "";

function control(container, label) {
  const element = allByRole(container, "button").find((candidate) => nameOf(candidate) === label);
  assert.ok(element, `the message offers a ${label} control`);
  return element;
}

function chips(container, paths) {
  return [...container.querySelectorAll("[title]")]
    .filter((element) => paths.includes(element.getAttribute("title")))
    .filter((element) => ![...element.children].some((child) => child.hasAttribute("title")));
}

function chipLabels(container, paths) {
  return chips(container, paths).map((element) => element.textContent.trim());
}

function paragraphs(container) {
  return [...container.querySelectorAll("p")];
}

function paragraphWith(container, fragment) {
  const paragraph = paragraphs(container).find((element) => element.textContent.includes(fragment));
  assert.ok(paragraph, `the message shows a paragraph containing ${fragment}`);
  return paragraph;
}

function visibleText(element, paths) {
  const known = new Set(chips(element, paths));
  const walk = (node) => {
    if (node.nodeType === 3) return node.data;
    if (known.has(node)) return `[${node.textContent.trim()}]`;
    return [...node.childNodes].map(walk).join("");
  };
  return walk(element).replace(/\s+/g, " ").trim();
}

function recordClipboard(t) {
  const copies = [];
  const original = Object.getOwnPropertyDescriptor(dom.window.navigator, "clipboard");
  Object.defineProperty(dom.window.navigator, "clipboard", {
    configurable: true,
    value: {
      async writeText(value) {
        copies.push(value);
      },
    },
  });
  t.after(() => {
    if (original) Object.defineProperty(dom.window.navigator, "clipboard", original);
    else delete dom.window.navigator.clipboard;
  });
  return copies;
}

function recordReveals(t) {
  const revealed = [];
  const original = Object.getOwnPropertyDescriptor(dom.window, "piBridge");
  dom.window.piBridge = {
    async showItemInFolder(filePath) {
      revealed.push(filePath);
    },
  };
  t.after(() => {
    if (original) Object.defineProperty(dom.window, "piBridge", original);
    else delete dom.window.piBridge;
  });
  return revealed;
}

function openMessage(t, content) {
  return mount(t, api.MessageView, {
    message: { role: "user", content, timestamp: 1 },
    cwd: CWD,
  });
}

test("a sentence with two attachments stays one paragraph with the chips inline", async (t) => {
  const view = await openMessage(t, SENTENCE);
  const sentences = paragraphs(view.container);
  assert.equal(sentences.length, 1, "the whole sentence is a single paragraph");
  assert.equal(visibleText(sentences[0], ["/tmp/shot.png", "src/main.ts"]), "看一下 [shot.png] 和 [main.ts] 的关系");
});

test("a fenced command keeps its attachment text inside one complete code block", async (t) => {
  const view = await openMessage(t, "运行下面的命令：\n\n```bash\ncat @src/a.ts | wc -l\n```\n\n然后告诉我结果");
  const codeBlocks = [...view.container.querySelectorAll("pre code")];
  assert.equal(codeBlocks.length, 1, "the fenced command stays a single code block");
  assert.match(codeBlocks[0].textContent, /^(?:\d+\s*)?cat @src\/a\.ts \| wc -l$/);
  assert.equal(chips(view.container, ["src/a.ts"]).length, 0, "code text stays literal, with no chip");
  assert.ok(paragraphWith(view.container, "运行下面的命令："), "the line before the block stays prose");
  assert.ok(paragraphWith(view.container, "然后告诉我结果"), "the line after the block stays prose");
});

test("an attachment inside inline code stays literal text instead of a chip", async (t) => {
  const view = await openMessage(t, "看这段 `cat @src/a.ts` 和 `@src/b.ts` 代码");
  assert.deepEqual(
    [...view.container.querySelectorAll("code")].map((element) => element.textContent),
    ["cat @src/a.ts", "@src/b.ts"],
  );
  assert.deepEqual(
    paragraphs(view.container).map((element) => element.textContent.trim()),
    ["看这段 cat @src/a.ts 和 @src/b.ts 代码"],
  );
});

test("a prose attachment becomes a chip with no leftover @ and no local-file link", async (t) => {
  const view = await openMessage(t, "看一下 @/tmp/shot.png 吧\n\nsee /tmp/report.md");
  const sentences = paragraphs(view.container);
  assert.equal(visibleText(sentences[0], ["/tmp/shot.png"]), "看一下 [shot.png] 吧");
  assert.equal(sentences.length, 2, "the sentence and the plain line stay separate paragraphs");
  assert.ok(!sentences[0].textContent.includes("@"), "the chip leaves no stray @ behind");
  const tokenLinks = [...view.container.querySelectorAll("a")].filter((element) =>
    element.textContent.includes("/tmp/shot.png"),
  );
  assert.deepEqual(tokenLinks, [], "the attached path is not also turned into a local-file link");
  const [plainLink] = sentences[1].querySelectorAll("a");
  assert.equal(plainLink.textContent, "/tmp/report.md");
  assert.match(plainLink.getAttribute("href"), /^file:/);
});

test("chips show the file name and keep the full path in the tooltip", async (t) => {
  const view = await openMessage(t, '看一下 @/tmp/shot.png 和 @src/main.ts 和 @"/x/my dir/report.md" 吧');
  for (const [path, label] of [
    ["/tmp/shot.png", "shot.png"],
    ["src/main.ts", "main.ts"],
    ["/x/my dir/report.md", "report.md"],
  ]) {
    const [chip] = chips(view.container, [path]);
    assert.ok(chip, `a chip shows the tooltip ${path}`);
    assert.equal(chip.textContent.trim(), label);
    assert.ok(!chip.textContent.includes('"'), `the chip for ${path} shows no quote characters`);
    assert.ok(!chip.getAttribute("title").includes('"'), `the tooltip for ${path} shows no quote characters`);
  }
});

test("markdown characters inside a path do not reformat the chip", async (t) => {
  const view = await openMessage(t, "打开 @pkg/__init__.py 和 @~/a.ts 或 @~/b.ts");
  assert.deepEqual(chipLabels(view.container, ["pkg/__init__.py", "~/a.ts", "~/b.ts"]), [
    "__init__.py",
    "a.ts",
    "b.ts",
  ]);
  assert.equal(view.container.querySelectorAll("strong").length, 0, "__init__ stays a file name, not bold text");
  assert.equal(view.container.querySelectorAll("del").length, 0, "~ stays a path, not struck-out text");
});

test("a mention and an email address stay ordinary text", async (t) => {
  const view = await openMessage(t, "hi @mention there\n\nmail a@b.ts");
  assert.deepEqual(
    paragraphs(view.container).map((element) => element.textContent.trim()),
    ["hi @mention there", "mail a@b.ts"],
  );
  assert.equal(chips(view.container, ["@mention", "mention", "a@b.ts"]).length, 0, "neither becomes a chip");
});

for (const [shape, content] of [
  ["the typed command", "/skill:fast-context 看 @src/main.ts"],
  [
    "pi's expanded block",
    '<skill name="fast-context" location="/home/u/.pi/agent/skills/fast-context/SKILL.md">\nBody.\n</skill>\n\n看 @src/main.ts',
  ],
]) {
  test(`a skill chip and an attachment chip share a paragraph with the prose for ${shape}`, async (t) => {
    const view = await openMessage(t, content);
    assert.ok(!view.container.textContent.includes("<skill"), "the raw skill block is never shown");
    const sentences = paragraphs(view.container);
    assert.equal(sentences.length, 1);
    const skill = text(view.container, "fast-context");
    assert.ok(skill, "the skill chip is shown");
    assert.ok(sentences[0].contains(skill), "the skill chip sits in the paragraph holding the prose");
    const [attachment] = chips(view.container, ["src/main.ts"]);
    assert.ok(attachment, "the attachment chip is shown");
    assert.ok(sentences[0].contains(attachment), "the attachment chip sits in the same paragraph");
    assert.match(visibleText(sentences[0], ["src/main.ts"]), /fast-context\s*看\s*\[main\.ts\]$/);
  });
}

test("the copy button copies the message the user sent, with the full paths", async (t) => {
  const copies = recordClipboard(t);
  const view = await openMessage(t, SENTENCE);
  await click(control(view.container, "Copy message"));
  assert.deepEqual(copies, [SENTENCE]);
});

test("clicking a chip reveals the file and an unlocatable path is not clickable", async (t) => {
  const revealed = recordReveals(t);
  const view = await openMessage(t, "看一下 @/tmp/shot.png 和 @src/main.ts 和 @../outside.ts 和 @~/a.ts");
  await click(control(view.container, "shot.png"));
  assert.deepEqual(revealed, ["/tmp/shot.png"]);
  await click(control(view.container, "main.ts"));
  assert.deepEqual(revealed, ["/tmp/shot.png", "/workspace/project/src/main.ts"]);
  for (const path of ["../outside.ts", "~/a.ts"]) {
    const [chip] = chips(view.container, [path]);
    assert.ok(chip, `the chip for ${path} is still shown`);
    assert.ok(!allByRole(view.container, "button").includes(chip), `the chip for ${path} is not activatable`);
    await click(chip);
  }
  assert.deepEqual(
    revealed,
    ["/tmp/shot.png", "/workspace/project/src/main.ts"],
    "an unlocatable path reveals nothing",
  );
});

test("raw html in a message cannot forge a chip or a reveal control", async (t) => {
  const revealed = recordReveals(t);
  const view = await openMessage(
    t,
    'x <span data-attachment-token="/etc/passwd">y</span> <attachment-token path="/etc/passwd">z</attachment-token>',
  );
  assert.equal(chips(view.container, ["/etc/passwd"]).length, 0, "no chip carries the forged path");
  assert.deepEqual(allByRole(view.container, "button").map(nameOf), ["Copy message"]);
  assert.deepEqual(revealed, []);
});

test("a focused chip keeps keyboard focus when an image preview finishes loading", async (t) => {
  let deliver;
  const preview = new Promise((resolve) => (deliver = resolve));
  const originalObjectUrl = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => "blob:focus-preview" });
  t.after(() => {
    if (originalObjectUrl) Object.defineProperty(URL, "createObjectURL", originalObjectUrl);
    else delete URL.createObjectURL;
  });
  const host = installRendererApi(dom.window, api, () => ({
    call(method, params) {
      assert.equal(method, "files.read");
      assert.equal(params.path, "/tmp/focus-preview.png");
      return preview;
    },
  }));
  const view = await mount(
    t,
    api.MessageView,
    { message: { role: "user", content: "看 @/tmp/focus-preview.png 和 @src/main.ts", timestamp: 1 }, cwd: CWD },
    { release: host.close },
  );
  const focused = control(view.container, "main.ts");
  focused.focus();
  assert.equal(dom.window.document.activeElement, focused);
  deliver({ encoding: "base64", content: "iVBORw0KGgo=", mime: "image/png" });
  await waitFor(() => assert.ok(chips(view.container, ["/tmp/focus-preview.png"])[0].querySelector("img")));
  assert.ok(focused.isConnected, "the focused chip is still the same control on the page");
  assert.equal(dom.window.document.activeElement, focused, "keyboard focus stays on the chip");
});
