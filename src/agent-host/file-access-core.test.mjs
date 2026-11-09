import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { validateExistingDirectory } from "./file-access-core.ts";

test("directory validation distinguishes a missing path, a file, and a valid directory", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "dexon-presence-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, "project");
  const file = path.join(root, "file.txt");
  mkdirSync(directory);
  writeFileSync(file, "content");
  assert.deepEqual(validateExistingDirectory(directory), {
    ok: true,
    path: directory,
    canonicalPath: realpathSync.native(directory),
  });
  assert.deepEqual(validateExistingDirectory(path.join(root, "missing")), {
    ok: false,
    reason: "missing",
    error: "Directory does not exist",
  });
  assert.deepEqual(validateExistingDirectory(file), { ok: false, reason: "not-directory", error: "Not a directory" });
  assert.deepEqual(validateExistingDirectory(path.join(file, "child")), {
    ok: false,
    reason: "not-directory",
    error: "Not a directory",
  });
});

for (const [code, reason] of [
  ["EACCES", "denied"],
  ["EPERM", "denied"],
  ["EIO", "io-error"],
]) {
  test(`directory validation reports ${reason} rather than missing after ${code}`, (t) => {
    t.mock.method(realpathSync, "native", () => {
      throw Object.assign(new Error("filesystem unavailable"), { code });
    });
    const result = validateExistingDirectory("/work/project");
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
    assert.equal(typeof result.error, "string");
  });
}
