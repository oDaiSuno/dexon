import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Phase 4 tripwire: the app navigation modules, the preview assembly and the
// capture script all stay inside the project-wide 500-line budget, so the
// preview tooling cannot quietly regrow into a monolith either.

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const MAX_LINES = 500;

const TARGETS = [
  { path: path.join(projectRoot, "src/renderer/components/app-nav"), kind: "dir" },
  { path: path.join(projectRoot, "src/smoke/ui-preview-data.mjs"), kind: "file" },
  { path: path.join(projectRoot, "src/smoke/ui-preview-api-mock.mjs"), kind: "file" },
  { path: path.join(projectRoot, "src/smoke/ui-preview-renderer.mjs"), kind: "file" },
  { path: path.join(projectRoot, "src/smoke/ui-preview-harness.ts"), kind: "file" },
  { path: path.join(projectRoot, "scripts/capture-ui-previews.mjs"), kind: "file" },
];

function collectCodeFiles(entry, files = []) {
  const stat = statSync(entry);
  if (stat.isDirectory()) {
    for (const name of readdirSync(entry)) collectCodeFiles(path.join(entry, name), files);
    return files;
  }
  if (/\.(?:ts|tsx|mjs)$/.test(entry) && !entry.endsWith(".test.mjs")) files.push(entry);
  return files;
}

function physicalLineCount(content) {
  const lines = content.split("\n");
  return content.endsWith("\n") ? lines.length - 1 : lines.length;
}

test("phase-4 targets exist (nav modules, preview assembly, capture script)", () => {
  const missing = TARGETS.filter((target) => !existsSync(target.path)).map((target) => target.path);
  assert.deepEqual(
    missing,
    [],
    `Phase 4 expects these targets to exist (tests stay RED until they do):\n${missing.join("\n")}`,
  );
});

test("app-nav modules, preview assembly and capture script stay within the 500-line budget", () => {
  const files = TARGETS.flatMap((target) => collectCodeFiles(target.path));
  assert.ok(files.length >= 6, `expected the phase-4 code files, found ${files.length}`);
  const offenders = files
    .map((file) => ({
      file: path.relative(projectRoot, file),
      lines: physicalLineCount(readFileSync(file, "utf8")),
    }))
    .filter((item) => item.lines > MAX_LINES);
  assert.deepEqual(
    offenders,
    [],
    `files exceed the ${MAX_LINES}-line budget:\n${offenders.map((item) => `${item.file}: ${item.lines}`).join("\n")}`,
  );
});
