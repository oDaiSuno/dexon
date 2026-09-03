import assert from "node:assert/strict";
import { stat, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { MAX_STAGED_IMAGE_BYTES, stageClipboardImage } from "./attachment-staging.ts";

test("stageClipboardImage writes owner-only pi-clipboard files in the temp dir", async (t) => {
  const bytes = Buffer.from("png-bytes");
  const result = await stageClipboardImage({ base64: bytes.toString("base64"), ext: "png" });
  assert.ok(result.ok);
  if (!result.ok) return;
  const stagedPath = result.staged.path;
  t.after(() => rm(stagedPath, { force: true }));
  assert.ok(stagedPath.startsWith(os.tmpdir()));
  assert.match(path.basename(stagedPath), /^pi-clipboard-[0-9a-f-]{36}\.png$/);
  const info = await stat(stagedPath);
  assert.equal(info.size, bytes.length);
  if (process.platform !== "win32") {
    assert.equal(info.mode & 0o777, 0o600);
  }
});

test("stageClipboardImage normalizes extensions case-insensitively", async (t) => {
  const result = await stageClipboardImage({ base64: Buffer.from("gif").toString("base64"), ext: ".GIF" });
  assert.ok(result.ok);
  if (!result.ok) return;
  t.after(() => rm(result.staged.path, { force: true }));
  assert.ok(result.staged.path.endsWith(".gif"));
});

test("stageClipboardImage rejects unsupported extensions", async () => {
  const result = await stageClipboardImage({ base64: Buffer.from("x").toString("base64"), ext: "heic" });
  assert.deepEqual(result, { ok: false, code: "unsupported-extension", message: "Unsupported image extension: heic" });
});

test("stageClipboardImage rejects empty and invalid payloads", async () => {
  const empty = await stageClipboardImage({ base64: "", ext: "png" });
  assert.ok(!empty.ok);
  if (!empty.ok) assert.equal(empty.code, "empty-payload");
  const malformed = await stageClipboardImage(null);
  assert.ok(!malformed.ok);
  if (!malformed.ok) assert.equal(malformed.code, "empty-payload");
});

test("stageClipboardImage rejects payloads above the staging size limit", async () => {
  const oversized = Buffer.alloc(MAX_STAGED_IMAGE_BYTES + 1, 1).toString("base64");
  const result = await stageClipboardImage({ base64: oversized, ext: "png" });
  assert.ok(!result.ok);
  if (result.ok) return;
  assert.equal(result.code, "too-large");
});
