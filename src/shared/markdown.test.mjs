import assert from "node:assert/strict";
import test from "node:test";

import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkCjkFriendly from "remark-cjk-friendly";
import remarkCjkFriendlyGfmStrikethrough from "remark-cjk-friendly-gfm-strikethrough";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import {
  chatRemarkPlugins,
  filePreviewRemarkPlugins,
  markdownRehypePlugins,
  userMessageRemarkPlugins,
} from "./markdown.ts";
import { remarkStandaloneDisplayMath } from "./standalone-display-math.ts";

test("Markdown plugins preserve GFM/math and sanitize raw HTML", () => {
  assert.deepEqual(filePreviewRemarkPlugins, [
    remarkGfm,
    remarkCjkFriendly,
    remarkCjkFriendlyGfmStrikethrough,
    remarkMath,
    remarkStandaloneDisplayMath,
  ]);
  assert.equal(markdownRehypePlugins[0], rehypeRaw);
  assert.equal(markdownRehypePlugins[1][0], rehypeSanitize);
  assert.equal(markdownRehypePlugins[2][0], rehypeKatex);
  assert.deepEqual(markdownRehypePlugins[2][1], { throwOnError: false, strict: false });
  const schema = markdownRehypePlugins[1][1];
  assert.deepEqual(schema.strip.slice(-4), ["iframe", "object", "style", "form"]);
  assert.ok(schema.protocols.href.includes("file"));
});

const pipelines = [
  ["chat", chatRemarkPlugins],
  ["file preview", filePreviewRemarkPlugins],
  ["user message", userMessageRemarkPlugins],
];

const proseExamples = [
  [
    "the boundary-test sentence",
    "补充或更新公共边界测试与 `scripts/test-user-bubble-electron.mjs` 端到端验证，覆盖“再编辑时新增图片/文件并发送”、“替换/移除原有附件”、“仅保留新增附件且清空文字时可发送、全部清空时禁用发送”以及“取消编辑不污染原消息”四个核心场景，并使用 `env -u PI_DESKTOP_USER_DATA` 运行验证给出实际通过结果。",
    "补充或更新公共边界测试与 scripts/test-user-bubble-electron.mjs 端到端验证，覆盖“再编辑时新增图片/文件并发送”、“替换/移除原有附件”、“仅保留新增附件且清空文字时可发送、全部清空时禁用发送”以及“取消编辑不污染原消息”四个核心场景，并使用 env -u PI_DESKTOP_USER_DATA 运行验证给出实际通过结果。",
    ["scripts/test-user-bubble-electron.mjs", "env -u PI_DESKTOP_USER_DATA"],
  ],
  ["an image/file phrase", "图片/文件", "图片/文件", []],
  ["a read/write phrase", "读/写", "读/写", []],
  ["a slash command", "/sharpen", "/sharpen", []],
  ["a bare POSIX path", "/tmp/report.md", "/tmp/report.md", []],
  ["a bare Windows path", String.raw`C:\Users\me\a.exe`, String.raw`C:\Users\me\a.exe`, []],
  ["a bare UNC path", String.raw`\\server\share\report.docx`, String.raw`\server\share\report.docx`, []],
  ["a bare directory path", "/tmp/dexon-ui-test.Xu9qVi/repo/folder", "/tmp/dexon-ui-test.Xu9qVi/repo/folder", []],
];

const linkExamples = [
  ["[MarkdownBody.tsx](/Users/me/project/src/MarkdownBody.tsx)", "/Users/me/project/src/MarkdownBody.tsx"],
  ["[说明](docs/release.md)", "docs/release.md"],
  ["[报告](file:///tmp/report.md)", "file:///tmp/report.md"],
  ["<file:///tmp/report.md>", "file:///tmp/report.md"],
  ["https://example.com", "https://example.com"],
];

for (const [pipeline, plugins] of pipelines) {
  for (const [example, markdown, expectedText, expectedInlineCode] of proseExamples) {
    test(`${pipeline} keeps ${example} as text without links`, async () => {
      const processor = unified().use(remarkParse).use(plugins);
      const tree = await processor.run(processor.parse(markdown));
      const nodes = [];
      visit(tree, (node) => {
        nodes.push(node);
      });
      assert.deepEqual(
        nodes.filter((node) => node.type === "link"),
        [],
      );
      assert.equal(
        nodes
          .filter((node) => node.type === "text" || node.type === "inlineCode")
          .map((node) => node.value)
          .join(""),
        expectedText,
      );
      assert.deepEqual(
        nodes.filter((node) => node.type === "inlineCode").map((node) => node.value),
        expectedInlineCode,
      );
    });
  }

  for (const [markdown, expectedUrl] of linkExamples) {
    test(`${pipeline} preserves the link in ${markdown}`, async () => {
      const processor = unified().use(remarkParse).use(plugins);
      const tree = await processor.run(processor.parse(markdown));
      const links = [];
      visit(tree, "link", (node) => {
        links.push(node);
      });
      assert.deepEqual(
        links.map((node) => node.url),
        [expectedUrl],
      );
    });
  }
}

const displayMathExamples = [
  ["a standalone root formula", "$$E=mc^2$$", ["E=mc^2"]],
  ["a bullet formula", "- 变换\n  $$E=mc^2$$", ["E=mc^2"]],
  ["a nested bullet formula", "- 外层\n  - 内层\n    $$E=mc^2$$", ["E=mc^2"]],
  ["an ordered-list formula", "1. 变换\n   $$E=mc^2$$", ["E=mc^2"]],
  ["a blockquote formula", "> 变换\n> $$E=mc^2$$", ["E=mc^2"]],
  ["a quoted-list formula", "> - 变换\n>   $$E=mc^2$$", ["E=mc^2"]],
  ["consecutive formulas", "$$a=1$$\n$$b=2$$", ["a=1", "b=2"]],
  ["three-dollar delimiters", "$$$a=1$$$", ["a=1"]],
  ["soft line boundaries", "前文\n$$a=1$$\n后文", ["a=1"]],
  ["hard line boundaries", "前文  \n$$a=1$$  \n后文", ["a=1"]],
  ["spaced line boundaries", "前文\n \t$$a=1$$ \t\n后文", ["a=1"]],
  ["CRLF line boundaries", "前文\r\n$$a=1$$\r\n后文", ["a=1"]],
  ["indented code", "    $$E=mc^2$$", []],
  ["fenced code", "```\n$$E=mc^2$$\n```", []],
  ["inline double-dollar math", "公式 $$a$$ 结束", []],
  ["two formulas on one line", "$$a$$ and $$b$$", []],
  ["standalone single-dollar math", String.raw`$\tau$`, []],
  ["empty math", "$$   $$", []],
];

for (const [pipeline, plugins] of pipelines) {
  for (const [example, markdown, expectedValues] of displayMathExamples) {
    test(`${pipeline} recognizes only standalone display math in ${example}`, async () => {
      const processor = unified().use(remarkParse).use(plugins);
      const tree = await processor.run(processor.parse(markdown), markdown);
      const displayValues = [];
      visit(tree, "math", (node) => {
        displayValues.push(node.value);
      });
      assert.deepEqual(displayValues, expectedValues);
      const htmlProcessor = unified().use(remarkParse).use(plugins).use(remarkRehype).use(markdownRehypePlugins);
      const rendered = await htmlProcessor.run(htmlProcessor.parse(markdown), markdown);
      const elements = [];
      visit(rendered, "element", (node) => {
        elements.push(node);
      });
      assert.equal(
        elements.filter((node) => node.properties.className?.includes("katex-display")).length,
        expectedValues.length,
      );
      assert.equal(elements.filter((node) => node.properties.className?.includes("katex-error")).length, 0);
    });
  }

  for (const boundary of ["\n", "  \n", "\r\n", "\n \t"]) {
    test(`${pipeline} splits surrounding prose cleanly at ${JSON.stringify(boundary)}`, async () => {
      const markdown = `前文${boundary}$$a=1$$${boundary}$$b=2$$${boundary}后文`;
      const processor = unified().use(remarkParse).use(plugins);
      const tree = await processor.run(processor.parse(markdown), markdown);
      assert.deepEqual(
        tree.children.map((node) => node.type),
        ["paragraph", "math", "math", "paragraph"],
      );
      assert.deepEqual(
        tree.children
          .filter((node) => node.type === "paragraph")
          .map((node) => node.children.map(({ type, value }) => ({ type, value }))),
        ["前文", "后文"].map((value) => [{ type: "text", value }]),
      );
    });
  }

  test(`${pipeline} safely keeps dollar math inline when run without the source file`, async () => {
    const processor = unified().use(remarkParse).use(plugins);
    const tree = await processor.run(processor.parse("$$a=1$$\n\n$\\tau$"));
    const inlineValues = [];
    visit(tree, "inlineMath", (node) => {
      inlineValues.push(node.value);
    });
    assert.deepEqual(inlineValues, ["a=1", "\\tau"]);
  });

  for (const [style, markdown, type, expected] of [
    ["bold", "另一个常见备选方案是**“按病患收拢结构”**——把", "strong", "“按病患收拢结构”"],
    ["strikethrough", "方案是~~“旧结构”~~——新结构", "delete", "“旧结构”"],
  ]) {
    test(`${pipeline} renders ${style} next to CJK punctuation without losing GFM tables or autolinks`, async () => {
      const document = `${markdown}\n\n| 名称 | 链接 |\n| --- | --- |\n| 方案 | https://example.com |`;
      const processor = unified().use(remarkParse).use(plugins);
      const tree = await processor.run(processor.parse(document), document);
      const nodes = [];
      visit(tree, (node) => {
        nodes.push(node);
      });
      assert.deepEqual(
        nodes.filter((node) => node.type === type).map((node) => node.children[0].value),
        [expected],
      );
      assert.equal(nodes.filter((node) => node.type === "table").length, 1);
      assert.deepEqual(
        nodes.filter((node) => node.type === "link").map((node) => node.url),
        ["https://example.com"],
      );
    });
  }
}
