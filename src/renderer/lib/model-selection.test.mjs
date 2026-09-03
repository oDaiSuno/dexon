import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..", "..", "..");
let modulePromise;

async function loadModule() {
  if (modulePromise) return modulePromise;
  modulePromise = (async () => {
    return importTestBundle("src/renderer/lib/model-selection", {
      absWorkingDir: root,
      entryPoints: ["src/renderer/lib/model-selection.ts"],
    });
  })();
  return modulePromise;
}

const models = [
  { provider: "openai", id: "gpt-5", name: "GPT-5" },
  { provider: "openai", id: "gpt-5-mini", name: "GPT-5 mini" },
  { provider: "anthropic", id: "claude-sonnet", name: "Claude Sonnet" },
];

test("null preferences enable every available model and disabling one expands exact refs", async () => {
  const { isModelEnabled, toggleModelEnabled } = await loadModule();
  assert.equal(isModelEnabled(models[0], null), true);
  assert.deepEqual(toggleModelEnabled(models, null, models[1], false), ["anthropic/claude-sonnet", "openai/gpt-5"]);
});

test("bare ids and thinking suffixes are recognized while unknown refs are preserved", async () => {
  const { isModelEnabled, toggleModelEnabled } = await loadModule();
  const current = ["gpt-5:high", "future/model"];
  assert.equal(isModelEnabled(models[0], current), true);
  assert.deepEqual(toggleModelEnabled(models, current, models[1], true), [
    "future/model",
    "openai/gpt-5",
    "openai/gpt-5-mini",
  ]);
});

test("enabling every known model collapses preferences back to all models", async () => {
  const { setProviderModelsEnabled } = await loadModule();
  const current = ["anthropic/claude-sonnet"];
  assert.equal(setProviderModelsEnabled(models, current, "openai", true), null);
});

test("modelSupportsImages reads declared modalities and stays null when unknown", async () => {
  const { modelSupportsImages } = await loadModule();
  const modalModels = [
    { id: "vision", name: "Vision", provider: "p", input: ["text", "image"] },
    { id: "text-only", name: "Text only", provider: "p", input: ["text"] },
    { id: "undeclared", name: "No modalities", provider: "p" },
  ];

  assert.equal(modelSupportsImages({ provider: "p", id: "vision" }, modalModels), true);
  assert.equal(modelSupportsImages({ provider: "p", id: "text-only" }, modalModels), false);
  assert.equal(modelSupportsImages({ provider: "p", id: "undeclared" }, modalModels), null);
  assert.equal(modelSupportsImages({ provider: "p", id: "unknown" }, modalModels), null);
  assert.equal(modelSupportsImages(null, modalModels), null);
});
