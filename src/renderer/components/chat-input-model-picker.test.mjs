import { restoreGlobals, harness, rootEl } from "./chat-input-file-reference.harness.mjs";
import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test, { after, beforeEach } from "node:test";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { accessibleName, allByRole, byRole, click, input, keyDown, text } from "../../../tests/support/dom-events.mjs";

const dom = harness.dom;
const { ChatInput, resetDraftCache, installApiShims, resetRpc, setAppLanguage } = await importTestBundle(
  "src/renderer/components/chat-input-model-picker",
  {
    stdin: {
      contents:
        'export { ChatInput } from "./ChatInput.tsx"; export { resetDraftCache } from "../lib/draft-store.ts"; export {installApiShims} from "../lib/api-fetch.ts"; export {resetRpc} from "../lib/api-client.ts"; export {setAppLanguage} from "../i18n.ts";',
      resolveDir: import.meta.dirname,
      sourcefile: "chat-input-model-picker-test-entry.tsx",
      loader: "tsx",
    },
    tsconfig: path.join(import.meta.dirname, "../../../tsconfig.renderer.json"),
    external: ["react", "react-dom", "react-dom/*"],
  },
);
harness.connectApi({ installApiShims, resetRpc });

after(() => restoreGlobals());
beforeEach(() => {
  harness.resetRequests();
  harness.storedValues.clear();
  resetDraftCache();
});

const CATALOG = [
  { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", provider: "anthropic", input: ["text", "image"] },
  { id: "gpt-5-codex", name: "gpt-5-codex", provider: "magpie", input: ["text"] },
  { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", provider: "google", input: ["text", "image"] },
  { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", provider: "anthropic", input: ["text", "image"] },
  { id: "gpt-5-mini", name: "GPT-5 mini", provider: "openai", input: ["text", "image"] },
  { id: "claude-opus-5-5", name: "claude-opus-5-5", provider: "magpie", input: ["text"] },
  { id: "claude-opus-4-5", name: "Claude Opus 4.5", provider: "anthropic", input: ["text", "image"] },
  { id: "gpt-5", name: "GPT-5", provider: "openai", input: ["text", "image"] },
];

const THINKING_LEVELS = {
  "anthropic:claude-haiku-4-5": ["off"],
  "anthropic:claude-sonnet-4-5": ["off", "low", "medium", "high"],
  "anthropic:claude-opus-4-5": ["off", "low", "medium", "high"],
  "magpie:claude-opus-5-5": ["off", "high"],
  "magpie:gpt-5-codex": ["off", "high"],
  "openai:gpt-5": ["off", "low", "high"],
  "openai:gpt-5-mini": ["off", "low", "high"],
  "google:gemini-2.5-pro": ["off", "low", "high"],
};

const REFRESH_WARNING = {
  provider: "magpie",
  code: "PROVIDER_REFRESH_FAILED",
  message: "Unable to refresh the magpie model catalog; cached models remain available.",
};

async function openPicker(t, overrides = {}) {
  setAppLanguage("zh-CN");
  t.after(() => setAppLanguage("en-US"));
  const calls = { picked: [], refreshed: 0, settings: 0 };
  const root = createRoot(rootEl);
  t.after(async () => {
    await act(async () => root.unmount());
    rootEl.textContent = "";
  });
  await act(async () =>
    root.render(
      createElement(ChatInput, {
        cwd: "/workspace/project",
        visible: true,
        isStreaming: false,
        model: { provider: "magpie", modelId: "claude-opus-5-5" },
        modelList: CATALOG,
        modelThinkingLevels: THINKING_LEVELS,
        modelCatalog: { source: "network", refreshed: true, aborted: false, warnings: [] },
        onModelChange: (provider, modelId) => calls.picked.push(`${provider}/${modelId}`),
        onModelsRefresh: () => {
          calls.refreshed += 1;
        },
        navigation: {
          openResources() {},
          openRemote() {},
          openModelSettings: () => {
            calls.settings += 1;
          },
        },
        onAbort() {},
        onSend() {},
        ...overrides,
      }),
    ),
  );
  const chip = rootEl.querySelector('button[aria-haspopup="dialog"]');
  assert.ok(chip, "the composer shows a model button that opens a dialog-like card");
  await click(chip);
  const card = byRole(dom.window.document.body, "dialog", "模型");
  assert.ok(card, "opening the model button shows a card named 模型");
  return { card, chip, calls };
}

const groupNames = (card) => allByRole(card, "group").map(accessibleName);
const rowNames = (container) =>
  allByRole(container, "button")
    .filter((row) => row.closest('[role="group"]'))
    .map(accessibleName);

test("when the model card opens, providers are listed Anthropic, OpenAI, Google Gemini, then custom providers under their own name, with Claude models ordered Opus, Sonnet, Haiku", async (t) => {
  const { card } = await openPicker(t);
  assert.deepEqual(groupNames(card), ["Anthropic", "OpenAI", "Google Gemini", "magpie"]);
  assert.deepEqual(rowNames(card), [
    "Claude Opus 4.5",
    "Claude Sonnet 4.5",
    "Claude Haiku 4.5",
    "GPT-5",
    "GPT-5 mini",
    "Gemini 2.5 Pro",
    "claude-opus-5-5",
    "gpt-5-codex",
  ]);
});

test("when the model card opens, its search box has focus and typing keeps only models whose name, id or provider name contains the text", async (t) => {
  const { card } = await openPicker(t);
  const search = byRole(card, "searchbox", "搜索模型…");
  assert.ok(search, "the card starts with a search box named 搜索模型…");
  assert.strictEqual(dom.window.document.activeElement, search, "the search box is focused when the card opens");

  await input(search, "SONNET");
  assert.deepEqual(rowNames(card), ["Claude Sonnet 4.5"]);
  assert.deepEqual(groupNames(card), ["Anthropic"]);

  await input(search, "google gemini");
  assert.deepEqual(rowNames(card), ["Gemini 2.5 Pro"], "the provider name Google Gemini also matches");

  await input(search, "magpie");
  assert.deepEqual(rowNames(card), ["claude-opus-5-5", "gpt-5-codex"]);

  await input(search, "opus-4-5");
  assert.deepEqual(rowNames(card), ["Claude Opus 4.5"], "the model id is searched too");

  await input(search, "zzz");
  assert.deepEqual(rowNames(card), []);
  assert.ok(text(card, "没有匹配的模型。"), "an empty search says that nothing matches");
});

test("when a model accepts images or supports reasoning, its row shows the matching capability icon, and only then", async (t) => {
  const { card } = await openPicker(t);
  const row = (name) => allByRole(card, "button").find((candidate) => accessibleName(candidate) === name);
  assert.ok(byRole(row("Claude Opus 4.5"), "img", "图片输入"));
  assert.ok(byRole(row("Claude Opus 4.5"), "img", "推理"));
  assert.ok(byRole(row("Claude Haiku 4.5"), "img", "图片输入"));
  assert.equal(
    byRole(row("Claude Haiku 4.5"), "img", "推理"),
    undefined,
    "a model that only supports off has no reasoning icon",
  );
  assert.equal(byRole(row("gpt-5-codex"), "img", "图片输入"), undefined, "a text-only model has no image icon");
  assert.ok(byRole(row("gpt-5-codex"), "img", "推理"));
});

test("when one provider fails to refresh, its group header shows 刷新失败 and the card never shows the host's English sentence", async (t) => {
  const { card } = await openPicker(t, {
    modelCatalog: { source: "network", refreshed: true, aborted: false, warnings: [REFRESH_WARNING] },
  });
  const magpie = byRole(card, "group", "magpie");
  const anthropic = byRole(card, "group", "Anthropic");
  assert.ok(magpie && anthropic, "each provider is a group named by its display name");
  assert.ok(text(magpie, "刷新失败"), "the failed provider's group says 刷新失败");
  assert.equal(text(anthropic, "刷新失败"), undefined, "other providers are not marked");
  assert.ok(byRole(magpie, "alert"), "the failure is announced");
  assert.doesNotMatch(card.textContent, /Unable to refresh/);
});

test("when the user clicks 刷新目录 the catalog refreshes, and 管理模型 closes the card and opens the model settings", async (t) => {
  const { card, calls } = await openPicker(t);
  await click(byRole(card, "button", "刷新目录"));
  assert.equal(calls.refreshed, 1);

  await click(byRole(card, "button", "管理模型"));
  assert.equal(calls.settings, 1);
  assert.equal(byRole(dom.window.document.body, "dialog", "模型"), undefined, "managing models closes the card");
});

test("when the user presses Enter in the search box the first matching model is chosen, and Escape closes the card and returns focus to the model button", async (t) => {
  const { card, chip, calls } = await openPicker(t);
  const search = byRole(card, "searchbox", "搜索模型…");
  await input(search, "gpt");
  await keyDown(search, "Enter");
  assert.deepEqual(calls.picked, ["openai/gpt-5"]);
  assert.equal(byRole(dom.window.document.body, "dialog", "模型"), undefined, "choosing a model closes the card");

  await click(chip);
  const reopened = byRole(dom.window.document.body, "dialog", "模型");
  assert.equal(byRole(reopened, "searchbox", "搜索模型…").value, "", "a reopened card starts with an empty search");
  await keyDown(byRole(reopened, "searchbox", "搜索模型…"), "Escape");
  assert.equal(byRole(dom.window.document.body, "dialog", "模型"), undefined, "Escape closes the card");
  assert.strictEqual(dom.window.document.activeElement, chip, "focus returns to the model button");
});
