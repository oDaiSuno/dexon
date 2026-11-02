import assert from "node:assert/strict";
import test from "node:test";
import { importTestBundle } from "#test-bundle";

const { toolIntentFromNames, adoptBirthToolIntent } = await importTestBundle("session-tool-intent-domain", {
  packages: "external",
  entryPoints: ["src/agent-host/agent-session/tool-intent.ts"],
});

test("an explicit managed-process selection remains a coding choice", () => {
  assert.deepEqual(toolIntentFromNames(["process_start", "process_stop"]), {
    kind: "agent",
    coding: ["process_start", "process_stop"],
  });
});

test("a recorded birth intent wins over later caller defaults", () => {
  const intents = new Map([["existing", { kind: "bare" }]]);
  assert.deepEqual(adoptBirthToolIntent(intents, "existing", { requested: ["read"] }), { kind: "bare" });
  assert.deepEqual(intents.get("existing"), { kind: "bare" });
});
