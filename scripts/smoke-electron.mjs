#!/usr/bin/env node
/**
 * Verify the actual production entry's single-instance handover, then the
 * renderer/Host workflows. Each phase owns isolated userData and completion
 * evidence; a zero exit alone cannot declare either phase successful.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { SMOKE_RESULT_FILE } from "../src/smoke/result.ts";
import { runElectronCheck } from "./electron-test-run.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertSuccessfulSpawn, resolvePackageFile } from "./process-utils.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, ".artifacts", "smoke");
const productionMain = path.join(root, "out", "main", "main.js");
const phases = [
  {
    label: "production-startup",
    main: path.join(output, "production-startup.js"),
    result: "production-startup-result.json",
  },
  { label: "host-workflows", main: path.join(output, "main.js"), result: SMOKE_RESULT_FILE },
];

const tsupCli = resolvePackageFile(root, "tsup", "dist/cli-default.js");
assertSuccessfulSpawn(
  spawnSync(process.execPath, [tsupCli, "--config", "tsup.smoke.config.ts"], { cwd: root, stdio: "inherit" }),
  "smoke build",
);
for (const main of [productionMain, ...phases.map((phase) => phase.main)]) {
  if (!existsSync(main)) throw new Error(`Missing smoke entry ${main}; build the application before running smoke.`);
}
const evidenceDirectory = path.join(output, "results");
mkdirSync(evidenceDirectory, { recursive: true });

async function runSmoke(phase) {
  const { completion, exit } = await runElectronCheck({
    name: phase.label,
    root,
    main: phase.main,
    resultName: phase.result,
    evidence: path.join(evidenceDirectory, phase.result),
    log: path.join(evidenceDirectory, `${phase.label}.log`),
    timeoutMs: 60_000,
  });
  if (
    phase.label === "production-startup" &&
    (completion.entry !== productionMain ||
      completion.handover !== true ||
      completion.firstInstanceStillServes !== true ||
      completion.secondInstance?.code !== 0 ||
      completion.secondInstance?.signal !== null ||
      completion.shutdown !== "will-quit")
  )
    throw new Error("Production startup completion does not prove handover, continued service and normal shutdown");
  console.log(`smoke: ${phase.label} completion evidence verified pid=${exit.pid}`);
}

try {
  for (const phase of phases) await runSmoke(phase);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
