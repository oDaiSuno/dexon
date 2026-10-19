import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { realRendererGraphOptions } from "./renderer-real-graph.mjs";

const projectRoot = path.resolve(import.meta.dirname, "../../..");

const { MessageView } = await importTestBundle("src/renderer/components/message-view", {
  stdin: {
    contents: 'export { MessageView } from "./MessageView.tsx";',
    resolveDir: import.meta.dirname,
    sourcefile: "message-view-test-entry.tsx",
    loader: "tsx",
  },
  jsx: "automatic",
  ...realRendererGraphOptions(projectRoot),
});

test("keeps the user copy action without timestamp or branch actions", () => {
  const html = renderToStaticMarkup(
    createElement(MessageView, {
      message: { role: "user", content: "copy me" },
    }),
  );

  assert.match(html, /title="Copy message"/);
});

test("channel attachment placeholders expose meaningful copy text", () => {
  const html = renderToStaticMarkup(
    createElement(MessageView, {
      message: {
        role: "user",
        channelSource: "telegram",
        channelAttachments: [{ kind: "file", name: "report.pdf", mime: "application/pdf" }],
        content: [{ type: "text", text: "\uFFFC" }],
      },
    }),
  );

  assert.match(html, /Attachment: report\.pdf \(application\/pdf\)/);
  assert.match(html, /title="Copy message"/);
});

test("legacy attachment placeholders without metadata disable copy", () => {
  const html = renderToStaticMarkup(
    createElement(MessageView, {
      message: { role: "user", channelSource: "weixin", content: "\uFFFC" },
    }),
  );

  assert.match(html, /title="Nothing to copy"/);
  assert.match(html, /disabled=""/);
});

function assistant(overrides = {}) {
  return {
    role: "assistant",
    provider: "openai",
    model: "gpt-test",
    content: [],
    ...overrides,
  };
}

test("a failed upstream request shows the provider's own words with no added heading", () => {
  const html = renderToStaticMarkup(
    createElement(MessageView, {
      message: assistant({ stopReason: "error", errorMessage: "401: invalid API key" }),
    }),
  );

  assert.match(html, /role="alert"/);
  assert.match(html, /401: invalid API key/);
  assert.doesNotMatch(html, /Model request failed/);
  assert.doesNotMatch(html, /Retried/);
});

test("a failure without provider detail states that plainly instead of guessing a cause", () => {
  const html = renderToStaticMarkup(
    createElement(MessageView, {
      message: assistant({ stopReason: "error" }),
    }),
  );

  assert.match(html, /The upstream service returned no error message/);
  assert.doesNotMatch(html, /API key/);
});

test("continues to hide a completed empty non-error assistant message", () => {
  assert.equal(renderToStaticMarkup(createElement(MessageView, { message: assistant() })), "");
});

test("renders compaction summaries collapsed by default", () => {
  const html = renderToStaticMarkup(
    createElement(MessageView, {
      message: {
        role: "custom",
        customType: "compaction",
        content: "A long summary that should stay hidden until requested.",
        display: true,
      },
    }),
  );

  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /Conversation compacted/);
  assert.doesNotMatch(html, /A long summary that should stay hidden/);
});
