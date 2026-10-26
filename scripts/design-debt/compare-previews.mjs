#!/usr/bin/env node
/**
 * Pixel-neutrality check for refactors. A screen passes when it is identical
 * to at least one baseline run; several baseline runs absorb the GPU's
 * run-to-run antialiasing flicker without hiding real changes.
 *
 *   node scripts/design-debt/compare-previews.mjs <candidate-dir> <baseline-dir>...
 */
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

const [candidate, ...baselines] = process.argv.slice(2);
if (!candidate || baselines.length === 0) {
  console.error("usage: compare-previews.mjs <candidate-dir> <baseline-dir>...");
  process.exit(2);
}

function differingPixels(a, b) {
  try {
    execFileSync("compare", ["-metric", "AE", a, b, "null:"], { stdio: "pipe" });
    return 0;
  } catch (error) {
    const output = String(error.stderr ?? "");
    const value = Number.parseFloat(output);
    if (Number.isFinite(value)) return value;
    throw error;
  }
}

let failed = 0;
for (const name of readdirSync(candidate)
  .filter((file) => file.endsWith(".png"))
  .sort()) {
  const counts = baselines.map((dir) => differingPixels(path.join(candidate, name), path.join(dir, name)));
  const best = Math.min(...counts);
  if (best !== 0) failed += 1;
  console.log(`${best === 0 ? "same" : "DIFF"}  ${name.padEnd(42)} ${counts.join(" ")}`);
}
console.log(failed === 0 ? "pixel-identical to the baseline" : `${failed} screens differ from every baseline run`);
process.exitCode = failed === 0 ? 0 : 1;
