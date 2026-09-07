import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * Permanent line-budget tripwire for the chat engine composition. These files
 * replaced a 2279-line monolith; the budget keeps each responsibility file
 * small enough to reason about (project rule HC-16/N19).
 */
const ENGINE_ROOT = path.resolve(import.meta.dirname, "../../hooks/agent-session");
const FACADE = path.resolve(import.meta.dirname, "../../hooks/useAgentSession.ts");

function listSourceFiles(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) return listSourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry) ? [full] : [];
  });
}

test("every chat engine file and the facade stay within the 500-line budget", () => {
  const files = [...listSourceFiles(ENGINE_ROOT), FACADE];
  const violations = [];
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n").length;
    if (lines > 500) violations.push(`${path.relative(process.cwd(), file)}: ${lines}`);
  }
  assert.ok(files.length >= 13, "the composition is split into responsibility modules");
  assert.deepEqual(violations, [], "500-line budget respected");
});
