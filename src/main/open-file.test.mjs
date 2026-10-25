import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { openValidatedMarkdownFile } from "./open-file.ts";

function workspace(t) {
  const root = mkdtempSync(path.join(tmpdir(), "dexon-open-file-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function recorder(result = "") {
  const opened = [];
  return {
    opened,
    openPath: async (target) => {
      opened.push(target);
      return result;
    },
  };
}

test("an existing SKILL.md is handed to the system's default app by its real path", async (t) => {
  const root = workspace(t);
  const file = path.join(root, "SKILL.md");
  writeFileSync(file, "# skill\n");
  const shell = recorder();
  await openValidatedMarkdownFile(file, shell);
  assert.deepEqual(shell.opened, [await realpath(file)]);
});

test("only Markdown files are opened; programs, folders, relative and missing paths are refused", async (t) => {
  const root = workspace(t);
  const program = path.join(root, "run.command");
  writeFileSync(program, "#!/bin/sh\n");
  const folder = path.join(root, "folder.md");
  mkdirSync(folder);
  const disguised = path.join(root, "notes.md");
  symlinkSync(program, disguised);
  const shell = recorder();
  for (const target of [program, folder, disguised, "SKILL.md", path.join(root, "missing.md"), `${root}/a\0.md`, 42]) {
    await assert.rejects(openValidatedMarkdownFile(target, shell));
  }
  assert.deepEqual(shell.opened, []);
});

test("a failure reported by the system is passed back to the caller", async (t) => {
  const root = workspace(t);
  const file = path.join(root, "SKILL.md");
  writeFileSync(file, "# skill\n");
  await assert.rejects(openValidatedMarkdownFile(file, recorder("No application can open this file")), {
    message: "No application can open this file",
  });
});
