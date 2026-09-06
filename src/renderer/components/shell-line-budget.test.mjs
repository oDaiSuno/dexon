import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Phase 2 split the two shell monoliths into responsibility modules. This
// tripwire keeps every module in the new directories — and the two thin
// composition roots — inside the project-wide 500-line budget, so future
// phases cannot quietly regrow monoliths here.

const componentsRoot = path.dirname(fileURLToPath(import.meta.url));
const MAX_LINES = 500;
const TARGETS = [
  path.join(componentsRoot, "AppShell.tsx"),
  path.join(componentsRoot, "SessionSidebar.tsx"),
  path.join(componentsRoot, "app-shell"),
  path.join(componentsRoot, "session-sidebar"),
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

test("shell and sidebar modules stay within the 500-line budget", () => {
  const files = TARGETS.flatMap((target) => collectCodeFiles(target));
  const covered = files.filter((file) => file.endsWith("AppShell.tsx") || file.endsWith("SessionSidebar.tsx"));
  assert.ok(
    covered.length === 2 && files.length > 2,
    "expected the two composition roots plus their split modules to exist",
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
