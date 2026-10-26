import { restoreGlobals, harness, rootEl } from "./chat-input-file-reference.harness.mjs";
import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test, { after, afterEach, beforeEach } from "node:test";
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";

const dom = harness.dom;

const { ChatInput, resetDraftCache, installApiShims, resetRpc, setAppLanguage } = await importTestBundle(
  "src/renderer/components/chat-input-slash-menu",
  {
    stdin: {
      contents:
        'export { ChatInput } from "./ChatInput.tsx"; export { resetDraftCache } from "../lib/draft-store.ts"; export {installApiShims} from "../lib/api-fetch.ts"; export {resetRpc} from "../lib/api-client.ts"; export {setAppLanguage} from "../i18n.ts";',
      resolveDir: import.meta.dirname,
      sourcefile: "chat-input-slash-menu-test-entry.tsx",
      loader: "tsx",
    },
    tsconfig: path.join(import.meta.dirname, "../../../tsconfig.renderer.json"),
    external: ["react", "react-dom", "react-dom/*"],
  },
);
harness.connectApi({ installApiShims, resetRpc });

const sourceInfo = { path: "/plugins/x", source: "local", scope: "user", origin: "top-level" };
const pluginCommands = [
  { name: "subagents", description: "Split a big task across sub agents", source: "extension", sourceInfo },
  {
    name: "review-pr",
    description: "Review the current pull request",
    source: "prompt",
    sourceInfo,
    argumentHint: "<pr-number>",
  },
  { name: "explain", description: "Explain the selected code", source: "prompt", sourceInfo },
];

const editorEl = () => rootEl.querySelector('[role="textbox"][aria-multiline="true"]');
let mounted = null;

async function mount() {
  await act(async () => {
    mounted = createRoot(rootEl);
    mounted.render(
      createElement(ChatInput, {
        cwd: "/workspace/project",
        isStreaming: false,
        onAbort() {},
        onSend() {},
        slashCommands: pluginCommands,
      }),
    );
  });
}

async function unmount() {
  if (!mounted) return;
  const root = mounted;
  mounted = null;
  await act(async () => root.unmount());
  rootEl.textContent = "";
}

async function type(text) {
  const el = editorEl();
  el.textContent = text;
  const range = dom.window.document.createRange();
  range.setStart(el.firstChild, text.length);
  range.collapse(true);
  dom.window.getSelection().removeAllRanges();
  dom.window.getSelection().addRange(range);
  await act(async () => {
    el.dispatchEvent(new dom.window.InputEvent("input", { bubbles: true }));
  });
}

const palette = () =>
  rootEl.querySelector('[role="group"][aria-label^="Slash commands"], [role="group"][aria-label^="斜杠命令"]');
const card = (name) =>
  [...palette().querySelectorAll("button")].find((button) => button.textContent.startsWith(`/${name}`));

afterEach(async () => {
  await unmount();
  setAppLanguage("en-US");
});
after(restoreGlobals);
beforeEach(() => {
  setAppLanguage("en-US");
  harness.resetRequests();
  harness.storedValues.clear();
  resetDraftCache();
});

test("when nothing matches the typed command, the palette says no command is related to it", async () => {
  await mount();
  await type("/deploy");
  assert.match(palette().textContent, /No commands match “\/deploy”/);
});

test("in Chinese, when nothing matches the typed command, the palette says no command is related to it", async () => {
  setAppLanguage("zh-CN");
  await mount();
  await type("/deploy");
  assert.match(palette().textContent, /没有和“\/deploy”相关的命令/);
});

test("built-in commands that take text show what to type after the name, and commands without arguments show nothing extra", async () => {
  setAppLanguage("zh-CN");
  await mount();
  await type("/");
  assert.match(card("compact").textContent, /^\/compact‹说明›/);
  assert.match(card("name").textContent, /^\/name‹名称›/);
  assert.doesNotMatch(card("session").textContent, /‹/);
  assert.doesNotMatch(card("copy").textContent, /‹/);
  assert.doesNotMatch(card("reload").textContent, /‹/);
});

test("in English, built-in commands that take text show what to type after the name", async () => {
  await mount();
  await type("/");
  assert.match(card("compact").textContent, /^\/compact‹instructions›/);
  assert.match(card("name").textContent, /^\/name‹name›/);
});

test("plugin commands show their own argument hint when they have one and nothing when they do not", async () => {
  await mount();
  await type("/");
  assert.match(card("review-pr").textContent, /^\/review-pr<pr-number>Review the current pull request/);
  assert.match(card("explain").textContent, /^\/explainExplain the selected code/);
  assert.match(card("subagents").textContent, /^\/subagentsSplit a big task across sub agents/);
});

test("matching still finds a command whose name only contains the typed text", async () => {
  await mount();
  await type("/agent");
  assert.ok(card("subagents"));
});
