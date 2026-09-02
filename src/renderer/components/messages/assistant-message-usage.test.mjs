import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test, { after } from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { AssistantMessageView } = await importTestBundle("src/renderer/components/messages/assistant-message", {
  stdin: {
    contents: 'export { AssistantMessageView } from "./AssistantMessage.tsx";',
    resolveDir: import.meta.dirname,
    sourcefile: "assistant-message-test-entry.tsx",
    loader: "tsx",
  },
  tsconfig: path.join(import.meta.dirname, "../../../../tsconfig.renderer.json"),
  external: ["react", "react-dom", "react-dom/*"],
  plugins: [
    {
      name: "stub-i18n",
      setup(buildApi) {
        buildApi.onResolve({ filter: /^@\/i18n$/ }, () => ({
          path: "i18n",
          namespace: "assistant-message-i18n",
        }));
        buildApi.onLoad({ filter: /.*/, namespace: "assistant-message-i18n" }, () => ({
          contents: 'export function useI18n() { return { language: "en", t(_key, fallback) { return fallback; } }; }',
          loader: "js",
        }));
      },
    },
    {
      // Keep the bundle light: markdown/syntax-highlighter are not exercised here.
      name: "stub-heavy-renderers",
      setup(buildApi) {
        buildApi.onResolve({ filter: /MarkdownBody$/ }, (args) => ({
          path: args.path,
          namespace: "assistant-message-stub",
        }));
        buildApi.onLoad({ filter: /.*/, namespace: "assistant-message-stub" }, () => ({
          contents: "export function MarkdownBody() { return null; }",
          loader: "js",
        }));
      },
    },
  ],
});

after(() => {
  if (previousActEnvironment === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  else globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

const baseMessage = {
  role: "assistant",
  provider: "acme",
  model: "flash-9",
  timestamp: Date.parse("2026-01-01T00:00:05.000Z"),
  content: [{ type: "text", text: "answer" }],
  usage: { input: 1234, output: 567, cost: { total: 0.0042 } },
  stopReason: "end_turn",
};

function renderView(testContext, props) {
  let renderer;
  act(() => {
    renderer = create(createElement(AssistantMessageView, props));
  });
  testContext.after(() => {
    if (renderer) act(() => renderer.unmount());
  });
  return renderer;
}

function collectText(node, out = []) {
  if (typeof node === "string") out.push(node);
  if (node && typeof node === "object" && Array.isArray(node.children)) {
    for (const child of node.children) collectText(child, out);
  }
  return out;
}

function rendererJsonAll(renderer) {
  const out = [];
  (function walk(n) {
    if (!n || typeof n !== "object") return;
    out.push(n);
    if (Array.isArray(n.children)) n.children.forEach(walk);
  })(renderer.toJSON());
  return out;
}

function renderedText(renderer) {
  return collectText(renderer.toJSON()).join(" ");
}

test("completed messages show the model usage line", (t) => {
  const text = renderedText(renderView(t, { message: baseMessage }));
  assert.match(text, /flash-9/, `rendered: ${text}`);
  assert.match(text, /1,234 in/, `rendered: ${text}`);
  assert.match(text, /567 out/, `rendered: ${text}`);
});

test("compact mode suppresses the per-message footer (usage row + copy button)", (t) => {
  const text = renderedText(renderView(t, { message: baseMessage, compact: true }));
  assert.doesNotMatch(text, /1,234 in/, `rendered: ${text}`);
  assert.doesNotMatch(text, /0\.0042/, `rendered: ${text}`);
  const buttons = rendererJsonAll(renderView(t, { message: baseMessage, compact: true }));
  assert.equal(buttons.filter((n) => n.props?.title === "Copy message").length, 0);
});

test("streaming messages never show the usage row", (t) => {
  const text = renderedText(renderView(t, { message: baseMessage, isStreaming: true }));
  assert.doesNotMatch(text, /1,234 in/, `rendered: ${text}`);
});

test("streaming header shows the live token estimate", (t) => {
  const text = renderedText(renderView(t, { message: baseMessage, isStreaming: true }));
  assert.match(text, /\d[\d,]*\s+tok/, `rendered: ${text}`);
});
