import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { workflowViolations } from "./desktop-workflow-policy.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (name) => YAML.parse(fs.readFileSync(path.join(root, name), "utf8"));
const failures = workflowViolations(read(".github/workflows/ci.yml"), read(".github/workflows/release.yml"));
const builder = read("electron-builder.yml");
if (builder.win?.artifactName !== "Dexon-Unsigned-Beta-Setup-${version}.${ext}" || builder.win?.publisherName) {
  failures.push(
    "Unsigned Windows packages must retain the visible Beta filename and must not claim a publisher identity",
  );
}
if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    "OK: required work, native targets, strict result aggregation, immutable actions and credential boundaries are intact",
  );
}
