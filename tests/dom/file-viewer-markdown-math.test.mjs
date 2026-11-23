import assert from "node:assert/strict";
import test, { after } from "node:test";
import { dom, loadRenderer, mount, restoreGlobals, waitFor } from "../support/renderer.mjs";
import { installRendererApi } from "../support/renderer-api.mjs";

const api = await loadRenderer(
  "file-viewer-markdown-math",
  'export {FileViewer} from "./src/renderer/components/FileViewer.tsx";',
);
after(restoreGlobals);

const CONTENT = "参数 \\[可选参数\\]，价格 $5 和 $10。\n";

function visibleText(element) {
  const copy = element.cloneNode(true);
  for (const source of copy.querySelectorAll(".katex-mathml")) source.remove();
  return copy.textContent.replace(/\s+/g, " ").trim();
}

test("when a markdown file holding \\[可选参数\\] and $5 和 $10 is previewed, the preview keeps today's rendering", async (t) => {
  const host = installRendererApi(dom.window, api, () => ({
    call(method) {
      if (method === "files.read") {
        return { content: CONTENT, language: "markdown", encoding: "utf8", size: CONTENT.length };
      }
      if (method === "git.headContent") return { comparable: false };
      return { ok: true };
    },
  }));
  const view = await mount(
    t,
    api.FileViewer,
    {
      environmentId: "primary",
      filePath: "/workspace/docs/notes.md",
      cwd: "/workspace",
      sourceSessionId: "session-one",
    },
    { release: host.close },
  );
  await waitFor(() => assert.ok(view.container.querySelector("p"), "the markdown file opens in the rendered preview"));

  const paragraph = view.container.querySelector("p");
  const shown = visibleText(paragraph);
  assert.ok(shown.startsWith("参数 [可选参数]，价格"), "the escaped bracket pair stays plain text");
  assert.doesNotMatch(shown, /\\/, "no backslash stays visible");
  assert.ok(shown.endsWith("10。"), "the text after the price pair stays outside the formula");
  assert.equal(view.container.querySelectorAll(".katex").length, 1, "the price pair still reads as one formula");
  assert.equal(view.container.querySelectorAll(".katex-display").length, 0, "the price formula stays inline");
  assert.equal(view.container.querySelectorAll(".katex-error").length, 0, "no red error appears");
});

async function openMarkdown(t, content) {
  const host = installRendererApi(dom.window, api, () => ({
    call(method) {
      if (method === "files.read") {
        return { content, language: "markdown", encoding: "utf8", size: content.length };
      }
      if (method === "git.headContent") return { comparable: false };
      return { ok: true };
    },
  }));
  const view = await mount(
    t,
    api.FileViewer,
    {
      environmentId: "primary",
      filePath: "/workspace/docs/notes.md",
      cwd: "/workspace",
      sourceSessionId: "session-one",
    },
    { release: host.close },
  );
  await waitFor(() => assert.ok(view.container.querySelector(".markdown-body"), "the rendered preview opens"));
  return view.container.querySelector(".markdown-body");
}

test("when a list formula precedes nested bullets, headings and a table, file preview preserves the whole document", async (t) => {
  const preview = await openMarkdown(
    t,
    String.raw`- 相机坐标变换：
  $$\mathbf{Y}_{\text{cam}} = \mathbf{y}_{\text{deformed}} \mathbf{R}_{\text{w2c}}^{\top} + \mathbf{t}_{\text{w2c}}$$
  - **保留子项**

### 后续说明

| 名称 | 数值 |
| --- | --- |
| 相机 | 1 |

**保留结尾**`,
  );
  assert.equal(
    preview.querySelectorAll("li .katex-display").length,
    1,
    "the display formula stays inside its list item",
  );
  assert.equal(preview.querySelectorAll(".katex").length, 1);
  assert.equal(preview.querySelectorAll(".katex-error").length, 0);
  assert.equal(preview.querySelector("ul ul li strong")?.textContent, "保留子项");
  assert.equal(preview.querySelector("h3")?.textContent, "后续说明");
  assert.equal(preview.querySelector("tbody td")?.textContent, "相机");
  assert.ok([...preview.querySelectorAll("strong")].some((node) => node.textContent === "保留结尾"));
});

for (const [shape, markdown, selector] of [
  ["a nested bullet", "- 外层\n  - 内层\n    $$E=mc^2$$", "ul ul li .katex-display"],
  ["an ordered list", "1. 变换\n   $$E=mc^2$$", "ol li .katex-display"],
  ["a blockquote", "> 变换\n> $$E=mc^2$$", "blockquote .katex-display"],
  ["a quoted bullet", "> - 变换\n>   $$E=mc^2$$", "blockquote li .katex-display"],
]) {
  test(`when file preview puts single-line display math inside ${shape}, the container is preserved`, async (t) => {
    const preview = await openMarkdown(t, markdown);
    assert.equal(preview.querySelectorAll(selector).length, 1);
    assert.equal(preview.querySelectorAll(".katex").length, 1);
    assert.equal(preview.querySelectorAll(".katex-error").length, 0);
  });
}

for (const [shape, markdown, inlineCount, codeText] of [
  ["indented code", "    $$E=mc^2$$", 0, "$$E=mc^2$$"],
  ["fenced code", "```\n$$E=mc^2$$\n```", 0, "$$E=mc^2$$"],
  ["inline double dollars", "公式 $$a$$ 结束", 1, null],
  ["two formulas on one line", "$$a$$ and $$b$$", 2, null],
  ["standalone single dollars", String.raw`$\tau$`, 1, null],
]) {
  test(`when file preview contains ${shape}, it does not invent display math`, async (t) => {
    const preview = await openMarkdown(t, markdown);
    assert.equal(preview.querySelectorAll(".katex-display").length, 0);
    assert.equal(preview.querySelectorAll(".katex").length, inlineCount);
    assert.equal(preview.querySelectorAll(".katex-error").length, 0);
    if (codeText) assert.ok(preview.querySelector("pre code")?.textContent.includes(codeText));
  });
}

for (const [shape, markdown, selector, expected] of [
  ["bold", "另一个常见备选方案是**“按病患收拢结构”**——把", "strong", "“按病患收拢结构”"],
  ["strikethrough", "方案是~~“旧结构”~~——新结构", "del", "“旧结构”"],
]) {
  test(`when file preview has ${shape} next to CJK punctuation, the emphasis renders`, async (t) => {
    const preview = await openMarkdown(t, markdown);
    assert.equal(preview.querySelector(selector)?.textContent, expected);
  });
}
