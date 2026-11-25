import assert from "node:assert/strict";
import test from "node:test";
import { importTestBundle } from "#test-bundle";

const { activeToolNamesFor } = await importTestBundle("execution-profile-codemode", {
  packages: "external",
  entryPoints: ["src/agent-host/agent-session/execution-profile.ts"],
});
const available = ["read", "bash", "codemode", "automation_result"];
const caps = { browserToolNames: new Set(), orchestrationEnabled: false, codemodeEnabled: true };
const step = { taskId: "task", runId: "run", stepId: "step", attemptNo: 1 };

test("interactive sessions honor the global Code Mode capability rather than the requested coding subset", () => {
  assert.deepEqual(activeToolNamesFor({ kind: "interactive", toolNames: ["read"] }, available, caps), [
    "read",
    "codemode",
    "automation_result",
  ]);
  assert.deepEqual(
    activeToolNamesFor({ kind: "interactive", toolNames: ["read"] }, available, { ...caps, codemodeEnabled: false }),
    ["read", "automation_result"],
  );
  assert.deepEqual(activeToolNamesFor({ kind: "interactive", toolNames: [] }, available, caps), []);
});

test("automation and sealed sessions never expose Code Mode even when the global capability is enabled", () => {
  const automation = { kind: "automation", step, tools: ["read"], result: { schema: {}, sink: {} } };
  assert.deepEqual(activeToolNamesFor(automation, available, caps), ["read", "automation_result"]);
  assert.deepEqual(activeToolNamesFor({ kind: "sealed", step }, available, caps), []);
});
