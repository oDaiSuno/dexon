import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Phase 3 split the settings/skills/plugins monoliths into responsibility
// modules. This tripwire keeps every module in the new directories — and the
// three composition roots — inside the project-wide 500-line budget, so
// future phases cannot quietly regrow monoliths here.

const componentsRoot = path.dirname(fileURLToPath(import.meta.url));
const MAX_LINES = 500;
const TARGETS = [
  path.join(componentsRoot, "SettingsConfig.tsx"),
  path.join(componentsRoot, "SkillsConfig.tsx"),
  path.join(componentsRoot, "PluginsConfig.tsx"),
  path.join(componentsRoot, "settings"),
  path.join(componentsRoot, "skills"),
  path.join(componentsRoot, "plugins"),
];

function collectCodeFiles(entry, files = []) {
  const stat = statSync(entry);
  if (stat.isDirectory()) {
    for (const name of readdirSync(entry)) collectCodeFiles(path.join(entry, name), files);
    return files;
  }
  if (/\.(?:ts|tsx|mjs)$/.test(entry)) files.push(entry);
  return files;
}

function physicalLineCount(content) {
  const lines = content.split("\n");
  return content.endsWith("\n") ? lines.length - 1 : lines.length;
}

test("resource and settings modules stay within the 500-line budget", () => {
  const files = TARGETS.flatMap((target) => collectCodeFiles(target));
  const roots = files.filter((file) =>
    ["SettingsConfig.tsx", "SkillsConfig.tsx", "PluginsConfig.tsx"].some((name) => file.endsWith(name)),
  );
  assert.ok(
    roots.length === 3 && files.length > 3,
    "expected the three composition roots plus their split modules to exist",
  );
  const offenders = files
    .map((file) => ({
      file: path.relative(componentsRoot, file),
      lines: physicalLineCount(readFileSync(file, "utf8")),
    }))
    .filter((item) => item.lines > MAX_LINES);
  assert.deepEqual(
    offenders,
    [],
    `files exceed the ${MAX_LINES}-line budget:\n${offenders.map((item) => `${item.file}: ${item.lines}`).join("\n")}`,
  );
});
