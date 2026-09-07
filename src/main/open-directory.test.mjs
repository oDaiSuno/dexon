import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { openValidatedDirectory } from "./open-directory.ts";

function makeTempRoot() {
  return mkdtempSync(path.join(tmpdir(), "dexon-open-directory-"));
}

test("opens the canonical real path of an existing directory", async () => {
  const root = makeTempRoot();
  try {
    const target = path.join(root, "workspace");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(target);
    const opened = [];
    await openValidatedDirectory(target, {
      realpath,
      stat,
      openPath: async (value) => {
        opened.push(value);
        return "";
      },
    });
    // /tmp is usually a symlink on macOS — the opener must receive the
    // canonical path, not the raw input.
    assert.deepEqual(opened, [await realpath(target)]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects paths that do not exist, are not absolute, or are not directories", async () => {
  const root = makeTempRoot();
  try {
    const filePath = path.join(root, "occupied.txt");
    writeFileSync(filePath, "occupied", "utf8");
    const opened = [];
    const opener = async (value) => {
      opened.push(value);
      return "";
    };

    await assert.rejects(
      openValidatedDirectory(path.join(root, "missing"), { realpath, stat, openPath: opener }),
      /Directory does not exist/,
    );
    await assert.rejects(
      openValidatedDirectory(path.join("relative", "dir"), { realpath, stat, openPath: opener }),
      /Invalid directory path/,
    );
    await assert.rejects(
      openValidatedDirectory(`${root}/bad\0name`, { realpath, stat, openPath: opener }),
      /Invalid directory path/,
    );
    await assert.rejects(openValidatedDirectory(filePath, { realpath, stat, openPath: opener }), /Not a directory/);
    await assert.rejects(openValidatedDirectory(42, { realpath, stat, openPath: opener }), /Invalid directory path/);
    assert.deepEqual(opened, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("surfaces the opener failure message instead of faking success", async () => {
  const root = makeTempRoot();
  try {
    await assert.rejects(
      openValidatedDirectory(root, {
        realpath,
        stat,
        openPath: async () => "Permission denied (os error 1)",
      }),
      /Permission denied/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
