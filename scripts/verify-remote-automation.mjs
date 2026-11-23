import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { root } from "./remote-automation/fixture.mjs";
import { authorization } from "./remote-automation/authorization.mjs";
import { offline } from "./remote-automation/offline.mjs";
import { lifecycle } from "./remote-automation/lifecycle.mjs";
import { isolation } from "./remote-automation/isolation.mjs";

const cases = new Map([
  ["E1", authorization],
  ["E2", offline],
  ["E3", lifecycle],
  ["E4", isolation],
]);
const selected = process.argv.slice(2);
assert.ok(
  selected.every((key) => cases.has(key)),
  "Usage: verify-remote-automation.mjs [E1 E2 E3 E4]",
);
const receiptPath = path.join(root, ".artifacts/remote-automation-e2e.json");
mkdirSync(path.dirname(receiptPath), { recursive: true });
rmSync(receiptPath, { force: true });
const receipt = {
  packagedPayload: "out/remote-payload",
  primaryArtifact: "out/main/agent-host.mjs",
  platform: process.platform,
  arch: process.arch,
  startedAtMs: Date.now(),
  cases: {},
};
for (const [name, verify] of cases) {
  if (selected.length && !selected.includes(name)) continue;
  console.log(`[remote-automation] ${name} running against real packaged daemon`);
  receipt.cases[name] = await verify();
  console.log(`[remote-automation] ${name} passed`);
}
receipt.finishedAtMs = Date.now();
receipt.complete = Object.keys(receipt.cases).length === cases.size;
writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n");
console.log(`[remote-automation] ${Object.keys(receipt.cases).join(", ")} passed; receipt ${receiptPath}`);
