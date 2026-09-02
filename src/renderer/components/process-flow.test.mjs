import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test, { after } from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { ProcessFlow, ThinkingExpansionStore } = await importTestBundle("src/renderer/components/process-flow", {
  stdin: {
    contents:
      'export { ProcessFlow } from "./ProcessFlow.tsx"; export { ThinkingExpansionStore } from "../lib/thinking-expansion-store.ts";',
    resolveDir: import.meta.dirname,
    sourcefile: "process-flow-test-entry.tsx",
    loader: "tsx",
  },
  tsconfig: path.join(import.meta.dirname, "../../../tsconfig.renderer.json"),
  external: ["react", "react-dom", "react-dom/*"],
  plugins: [
    {
      name: "stub-i18n",
      setup(buildApi) {
        buildApi.onResolve({ filter: /^@\/i18n$/ }, () => ({
          path: "i18n",
          namespace: "process-flow-test",
        }));
        buildApi.onLoad({ filter: /.*/, namespace: "process-flow-test" }, () => ({
          contents: 'export function useI18n() { return { language: "en", t(_key, fallback) { return fallback; } }; }',
          loader: "js",
        }));
      },
    },
    {
      // Keep the bundle light: markdown/syntax-highlighter and the custom
      // message views are not exercised by these tests.
      name: "stub-heavy-renderers",
      setup(buildApi) {
        buildApi.onResolve({ filter: /MarkdownBody$|SystemMessages$/ }, (args) => ({
          path: args.path,
          namespace: "process-flow-stub",
        }));
        buildApi.onLoad({ filter: /.*/, namespace: "process-flow-stub" }, () => ({
          contents:
            "export function MarkdownBody() { return null; }\n" +
            "export function CompactionMessageView() { return null; }\n" +
            "export function CustomMessageView() { return null; }",
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

function thinkingItem(key, text, extra = {}) {
  return { kind: "thinking", key, block: { type: "thinking", thinking: text }, blockIndex: 0, entryId: "e1", ...extra };
}

function findRow(root, rowClass) {
  return root.find(
    (node) => typeof node.props?.className === "string" && node.props.className.split(" ").includes(rowClass),
  );
}

function hasChevron(root) {
  return root.findAll((node) => node.props?.className === "chat-tool-chev").length > 0;
}

test("thinking row renders a summary chip and a gray full-text box without any chevron", async () => {
  const store = new ThinkingExpansionStore();
  const items = [thinkingItem("t1", "first line\nsecond line with details")];
  let renderer;
  await act(async () => {
    renderer = create(createElement(ProcessFlow, { items, thinkingExpansionStore: store }));
  });

  const toggle = findRow(renderer.root, "chat-think-row");
  assert.equal(toggle.props["aria-expanded"], false);
  assert.equal(hasChevron(renderer.root), false);

  const chip = renderer.root.findByProps({ className: "chat-tool-chip" });
  assert.match(chip.props.children, /first line second line with details/);

  await act(async () => toggle.props.onClick());
  const box = renderer.root.findByProps({ className: "chat-think-box" });
  assert.match(box.props.children, /first line\nsecond line with details/);

  await act(async () => toggle.props.onClick());
  assert.equal(findRow(renderer.root, "chat-think-row").props["aria-expanded"], false);
  await act(async () => renderer.unmount());
});

test("tool call rows keep their detail expansion but expose no chevron", async () => {
  const items = [
    {
      kind: "toolCall",
      key: "tc1",
      block: { type: "toolCall", toolCallId: "call-1", toolName: "bash", input: { command: "ls" } },
      blockIndex: 0,
      entryId: "e1",
    },
  ];
  let renderer;
  await act(async () => {
    renderer = create(createElement(ProcessFlow, { items }));
  });

  assert.equal(hasChevron(renderer.root), false);
  const row = findRow(renderer.root, "chat-tool-row");
  await act(async () => row.props.onClick());
  assert.ok(renderer.root.findByProps({ className: "chat-tool-detail" }));
  await act(async () => renderer.unmount());
});

test("items render in the given order with a running spinner state preserved", async () => {
  const store = new ThinkingExpansionStore();
  const items = [
    thinkingItem("t1", "thought"),
    {
      kind: "toolCall",
      key: "tc1",
      block: { type: "toolCall", toolCallId: "call-1", toolName: "grep", input: { pattern: "x" } },
      blockIndex: 1,
      entryId: "e1",
    },
    { kind: "text", key: "tx1", block: { type: "text", text: "checking output" } },
  ];
  let renderer;
  await act(async () => {
    renderer = create(createElement(ProcessFlow, { items, thinkingExpansionStore: store }));
  });

  assert.equal(hasChevron(renderer.root), false);
  assert.ok(renderer.root.findByProps({ className: "chat-scmorph-spinring" }));
  const chips = renderer.root.findAllByProps({ className: "chat-tool-chip" });
  assert.equal(chips.length, 2);
  assert.match(chips[0].props.children, /thought/);
  assert.match(chips[1].props.children, /x/);
  await act(async () => renderer.unmount());
});
