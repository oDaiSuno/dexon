import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { importTestBundle } from "#test-bundle";

const { deriveModelPickerBodyState } = await importTestBundle("model-picker-state", {
  entryPoints: [fileURLToPath(new URL("./model-picker-state.ts", import.meta.url))],
});
const groups = [{ provider: "fixture" }];
const derive = (options) => deriveModelPickerBodyState({ groups: [], visible: [], query: "", ...options });

for (const [name, options, kind] of [
  ["initial read", { modelLoading: true }, "loading"],
  ["empty refresh", { modelRefreshing: true }, "loading"],
  ["closed transport", { modelReconnecting: true, modelLoading: true }, "reconnecting"],
  ["backend failure", { modelLoadError: "catalog unavailable" }, "failed"],
  ["no configured models", {}, "empty-catalog"],
  ["empty catalog with search text", { query: "alpha" }, "empty-catalog"],
  ["unmatched query", { groups, query: "alpha" }, "no-match"],
  ["no visible choices without a query", { groups }, "empty-catalog"],
  ["available choices", { groups, visible: groups }, "list"],
  ["refresh failure with usable choices", { groups, visible: groups, modelLoadError: "refresh unavailable" }, "list"],
]) {
  test(`${name} has the ${kind} presentation`, () => {
    assert.equal(derive(options).kind, kind);
  });
}

test("a reconnecting picker distinguishes waiting from cached choices", () => {
  assert.deepEqual(derive({ modelReconnecting: true }), {
    kind: "reconnecting",
    hasCachedList: false,
    cachedGroups: [],
  });
  assert.deepEqual(derive({ modelReconnecting: true, groups, visible: groups }), {
    kind: "reconnecting",
    hasCachedList: true,
    cachedGroups: groups,
  });
});
