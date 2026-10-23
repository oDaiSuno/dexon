import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..", "..", "..");
let modulePromise;

async function loadModule() {
  if (modulePromise) return modulePromise;
  modulePromise = (async () => {
    return importTestBundle("src/renderer/lib/models-config-state", {
      absWorkingDir: root,
      entryPoints: ["src/renderer/lib/models-config-state.ts"],
    });
  })();
  return modulePromise;
}

test("editing one model preserves v0.84 sampling, nullable headers, and unknown fields", async () => {
  const { saveModelEntry, saveProviderEntry } = await loadModule();
  const original = {
    revision: 7,
    providers: {
      custom: {
        api: "openai-completions",
        headers: { Authorization: "Bearer test", "X-Remove-Me": null },
        futureProviderField: { nested: true },
        models: [
          {
            id: "model-one",
            name: "Old name",
            samplingParams: { temperature: 0.25, thinking_token_budget: 2048 },
            compat: { futureCompat: "preserved" },
            futureModelField: [1, 2, 3],
          },
        ],
      },
    },
  };
  const selected = original.providers.custom.models[0];
  const provider = saveModelEntry(original.providers.custom, 0, { ...selected, name: "New name" });
  const saved = saveProviderEntry(original, "custom", "custom", provider);

  assert.equal(saved.ok, true);
  const updated = saved.config;
  assert.equal(updated.providers.custom.models[0].name, "New name");
  assert.deepEqual(updated.providers.custom.models[0].samplingParams, selected.samplingParams);
  assert.deepEqual(updated.providers.custom.models[0].futureModelField, selected.futureModelField);
  assert.deepEqual(updated.providers.custom.headers, original.providers.custom.headers);
  assert.deepEqual(updated.providers.custom.futureProviderField, original.providers.custom.futureProviderField);
  assert.equal(updated.revision, 7);
  assert.equal(original.providers.custom.models[0].name, "Old name");
});

test("setting a built-in provider base URL creates an override without redefining models", async () => {
  const { setProviderBaseUrl } = await loadModule();
  const original = { revision: 7, providers: {} };

  const updated = setProviderBaseUrl(original, "openai", "  https://proxy.example.com/v1  ");

  assert.deepEqual(updated, {
    revision: 7,
    providers: { openai: { baseUrl: "https://proxy.example.com/v1" } },
  });
  assert.deepEqual(original, { revision: 7, providers: {} });
});

test("clearing a provider base URL preserves other provider fields and removes empty overrides", async () => {
  const { setProviderBaseUrl } = await loadModule();
  const withOtherFields = {
    providers: {
      openai: {
        baseUrl: "https://proxy.example.com/v1",
        headers: { "X-Tenant": "tenant-one", "X-Optional": null },
        futureField: true,
      },
    },
  };

  assert.deepEqual(setProviderBaseUrl(withOtherFields, "openai", ""), {
    providers: {
      openai: {
        headers: { "X-Tenant": "tenant-one", "X-Optional": null },
        futureField: true,
      },
    },
  });
  assert.deepEqual(
    setProviderBaseUrl({ providers: { openai: { baseUrl: "https://proxy.example.com/v1" } } }, "openai", "  "),
    { providers: {} },
  );
});

test("saving a provider under a new name rejects conflicts and reserved or empty names without changing config", async () => {
  const { saveProviderEntry } = await loadModule();
  const original = {
    revision: 7,
    providers: {
      alpha: { api: "openai-completions", futureField: "alpha" },
      beta: { api: "anthropic-messages", futureField: "beta" },
    },
  };

  for (const requestedName of [" beta ", "", "   ", "__proto__", "prototype", "constructor"]) {
    const result = saveProviderEntry(original, "alpha", requestedName, original.providers.alpha);
    assert.equal(result.ok, false, requestedName);
    assert.equal(result.config, original);
    assert.deepEqual(Object.keys(original.providers), ["alpha", "beta"]);
  }

  const renamed = saveProviderEntry(original, "alpha", " gamma ", original.providers.alpha);
  assert.equal(renamed.ok, true);
  assert.equal(renamed.name, "gamma");
  assert.deepEqual(Object.keys(renamed.config.providers), ["gamma", "beta"]);
  assert.deepEqual(renamed.config.providers.gamma, original.providers.alpha);
  assert.deepEqual(renamed.config.providers.beta, original.providers.beta);
  assert.deepEqual(Object.keys(original.providers), ["alpha", "beta"]);
});

test("provider deletion and model addition or removal compute new config without side effects", async () => {
  const { deleteModelEntry, deleteProviderEntry, saveModelEntry } = await loadModule();
  const original = {
    revision: 7,
    providers: {
      alpha: { models: [{ id: "one" }], futureField: true },
      beta: { api: "anthropic-messages" },
    },
  };

  const deleted = deleteProviderEntry(original, "alpha");
  assert.deepEqual(Object.keys(deleted.providers), ["beta"]);
  assert.equal(deleted.revision, 7);
  assert.equal(deleteProviderEntry(original, "missing"), original);

  const added = saveModelEntry(original.providers.alpha, null, { id: "two" });
  assert.deepEqual(added.models, [{ id: "one" }, { id: "two" }]);
  assert.equal(added.futureField, true);

  const emptied = deleteModelEntry(original.providers.alpha, 0);
  assert.equal(emptied.models, undefined);
  assert.equal(emptied.futureField, true);

  assert.deepEqual(original.providers.alpha.models, [{ id: "one" }]);
  assert.equal(original.providers.alpha.futureField, true);
});

test("new custom providers get a unique name and are appended without touching existing ones", async () => {
  const { nextCustomProviderName, saveProviderEntry } = await loadModule();
  const original = {
    revision: 7,
    providers: { "new-provider": { api: "anthropic-messages", futureField: true } },
  };

  const firstName = nextCustomProviderName(original);
  assert.equal(firstName, "new-provider-1");
  const first = saveProviderEntry(original, null, firstName, { api: "openai-completions" });
  assert.equal(first.ok, true);
  const secondName = nextCustomProviderName(first.config);
  assert.equal(secondName, "new-provider-2");
  const second = saveProviderEntry(first.config, null, secondName, { api: "openai-completions" });

  assert.deepEqual(Object.keys(second.config.providers), ["new-provider", "new-provider-1", "new-provider-2"]);
  assert.deepEqual(second.config.providers["new-provider-2"], { api: "openai-completions" });
  assert.deepEqual(original.providers, { "new-provider": { api: "anthropic-messages", futureField: true } });
  assert.equal(saveProviderEntry(original, null, "new-provider", {}).ok, false);
});
