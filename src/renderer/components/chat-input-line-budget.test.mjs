import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const componentsRoot = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(componentsRoot, "../..");
const maxLines = 500;
const requiredModules = [
  "chat-input/types.ts",
  "chat-input/use-composer-draft.ts",
  "chat-input/use-composer-attachments.ts",
  "chat-input/use-composer-suggestions.ts",
  "chat-input/use-composer-controls.ts",
  "chat-input/use-composer-skills.ts",
  "chat-input/composer-view.tsx",
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

function physicalLineCount(file) {
  const source = readFileSync(file, "utf8");
  return source.endsWith("\n") ? source.split("\n").length - 1 : source.split("\n").length;
}

test("ChatInput is split into the approved responsibility modules", () => {
  const missing = requiredModules.filter((relative) => !existsSync(path.join(componentsRoot, relative)));
  assert.deepEqual(missing, [], "every approved ChatInput responsibility module must exist");
});

test("ChatInput responsibility modules stay within the 500-line budget", () => {
  const files = [
    path.join(componentsRoot, "ChatInput.tsx"),
    ...collectCodeFiles(path.join(componentsRoot, "chat-input")),
  ];
  const offenders = files
    .map((file) => ({ file: path.relative(projectRoot, file), lines: physicalLineCount(file) }))
    .filter(({ lines }) => lines > maxLines);
  assert.deepEqual(
    offenders,
    [],
    `ChatInput files exceed ${maxLines} physical lines:\n${offenders.map(({ file, lines }) => `${file}: ${lines}`).join("\n")}`,
  );
});
