import assert from "node:assert/strict";
import test from "node:test";

import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import {
  chatRemarkPlugins,
  filePreviewRemarkPlugins,
  markdownRehypePlugins,
  userMessageRemarkPlugins,
} from "./markdown.ts";

test("Markdown plugins preserve GFM/math and sanitize raw HTML", () => {
  assert.deepEqual(filePreviewRemarkPlugins, [remarkGfm, remarkMath]);
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
