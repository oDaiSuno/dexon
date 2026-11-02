import assert from "node:assert/strict";
import test from "node:test";
import { groupModelOptions, providerDisplayName } from "./model-catalog.ts";

const azureModel = { provider: "azure", modelId: "gpt-5", name: "GPT-5", image: true, reasoning: true };

test("the Azure channel is shown as Azure OpenAI", () => {
  assert.equal(providerDisplayName("azure"), "Azure OpenAI");
});

test("models of the Azure channel are grouped as a built-in channel named Azure OpenAI", () => {
  const [group] = groupModelOptions([azureModel]);
  assert.equal(group.provider, "azure");
  assert.equal(group.name, "Azure OpenAI");
  assert.equal(group.custom, false);
  assert.deepEqual(group.options, [azureModel]);
});
