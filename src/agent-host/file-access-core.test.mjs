import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, promises, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createPathAccess, validateExistingDirectory } from "./file-access-core.ts";

const directoryLink = process.platform === "win32" ? "junction" : "dir";

function temporaryDirectory(t, label) {
  const directory = mkdtempSync(path.join(tmpdir(), label));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function recordRealpath(t, stalls = () => false) {
  const original = promises.realpath;
  const calls = [];
  const stalled = [];
  t.mock.method(promises, "realpath", (target, ...rest) => {
    calls.push(String(target));
    if (stalls(String(target))) return new Promise((_, reject) => stalled.push(reject));
    return original.call(promises, target, ...rest);
  });
  t.after(() => {
    for (const reject of stalled) reject(Object.assign(new Error("mount went away"), { code: "ENOENT" }));
  });
  return { calls, stalled };
}

async function turnsUntil(predicate) {
  while (!predicate()) await new Promise((resolve) => setImmediate(resolve));
}

test("directory validation distinguishes a missing path, a file, and a valid directory", async (t) => {
  const root = temporaryDirectory(t, "dexon-presence-");
  const directory = path.join(root, "project");
  const file = path.join(root, "file.txt");
  mkdirSync(directory);
  writeFileSync(file, "content");
  assert.deepEqual(await validateExistingDirectory(directory), {
    ok: true,
    path: directory,
    canonicalPath: realpathSync.native(directory),
  });
  assert.deepEqual(await validateExistingDirectory(path.join(root, "missing")), {
    ok: false,
    reason: "missing",
    error: "Directory does not exist",
  });
  assert.deepEqual(await validateExistingDirectory(file), {
    ok: false,
    reason: "not-directory",
    error: "Not a directory",
  });
  assert.deepEqual(await validateExistingDirectory(path.join(file, "child")), {
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
  test(`directory validation reports ${reason} rather than missing after ${code}`, async (t) => {
    t.mock.method(promises, "realpath", async () => {
      throw Object.assign(new Error("filesystem unavailable"), { code });
    });
    const result = await validateExistingDirectory("/work/project");
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
    assert.equal(typeof result.error, "string");
  });
}

test("a missing outside prefix is rejected without touching the disk again for ten seconds", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  const root = temporaryDirectory(t, "dexon-access-root-");
  const allowed = await createPathAccess().prepare([root]);
  const { calls } = recordRealpath(t);
  const missingMount = path.join(path.sep, `dexon-missing-mount-${Math.random().toString(36).slice(2)}`);

  assert.equal(await allowed.allows(path.join(missingMount, "home", "dev", "notes.txt")), false);
  const firstLookup = calls.length;
  assert.ok(firstLookup > 0, "the first check resolves the path on disk");

  assert.equal(await allowed.allows(path.join(missingMount, "projects", "app.ts")), false);
  assert.equal(await allowed.allows(missingMount), false);
  t.mock.timers.tick(9_999);
  assert.equal(await allowed.allows(path.join(missingMount, "home", "dev", "notes.txt")), false);
  assert.equal(calls.length, firstLookup, "checks under the remembered missing prefix make zero disk calls");

  t.mock.timers.tick(2);
  assert.equal(await allowed.allows(path.join(missingMount, "projects", "app.ts")), false);
  assert.ok(calls.length > firstLookup, "after ten seconds the prefix is looked up on disk again");
});

test("a symlink that leads outside the allowed roots is always rejected and the missing-prefix memory never grants access", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 2_000_000 });
  const base = temporaryDirectory(t, "dexon-access-escape-");
  const root = path.join(base, "root");
  const outside = path.join(base, "outside");
  mkdirSync(root);
  mkdirSync(outside);
  writeFileSync(path.join(outside, "secret.txt"), "secret");
  symlinkSync(outside, path.join(root, "escape"), directoryLink);
  const allowed = await createPathAccess().prepare([root]);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    assert.equal(await allowed.allows(path.join(root, "escape", "secret.txt")), false);
    assert.equal(await allowed.allows(path.join(root, "escape", "not-created", "file.txt")), false);
  }
  assert.equal(await allowed.allows(path.join(root, "notes", "new-file.txt")), true);

  const lateLink = path.join(base, "late-link");
  assert.equal(await allowed.allows(path.join(lateLink, "notes.txt")), false);
  symlinkSync(root, lateLink, directoryLink);
  assert.equal(
    await allowed.allows(path.join(lateLink, "notes.txt")),
    false,
    "within ten seconds the remembered prefix can only keep rejecting",
  );
  t.mock.timers.tick(10_001);
  assert.equal(
    await allowed.allows(path.join(lateLink, "notes.txt")),
    true,
    "once forgotten, the real resolution into the root decides",
  );

  const outsideLink = path.join(base, "outside-link");
  assert.equal(await allowed.allows(path.join(outsideLink, "secret.txt")), false);
  symlinkSync(outside, outsideLink, directoryLink);
  t.mock.timers.tick(10_001);
  assert.equal(
    await allowed.allows(path.join(outsideLink, "secret.txt")),
    false,
    "after the memory expires a link that leaves the roots is still rejected",
  );
});

test("a missing folder that still holds an allowed root is never remembered as a reason to reject", async (t) => {
  const base = realpathSync.native(temporaryDirectory(t, "dexon-access-alias-"));
  const real = path.join(base, "real");
  const alias = path.join(base, "alias");
  mkdirSync(real);
  symlinkSync(real, alias, directoryLink);
  const allowed = await createPathAccess().prepare([path.join(real, "missing-parent", "project")]);

  assert.equal(await allowed.allows(path.join(alias, "missing-parent", "other.txt")), false);
  assert.equal(
    await allowed.allows(path.join(alias, "missing-parent", "project", "notes.txt")),
    true,
    "a path that resolves into the not-yet-created root stays allowed after a sibling lookup failed",
  );
});

test("four stalled outside lookups never delay checks inside an allowed root", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const root = temporaryDirectory(t, "dexon-access-busy-");
  const laterRoot = temporaryDirectory(t, "dexon-access-later-");
  const access = createPathAccess();
  const allowed = await access.prepare([root]);
  const stalledMount = path.join(path.sep, "dexon-stalled-mount");
  const { stalled } = recordRealpath(t, (target) => target.includes("dexon-stalled-mount"));

  const slow = ["a", "b", "c", "d"].map((name) => allowed.allows(path.join(stalledMount, name, "file.txt")));
  await turnsUntil(() => stalled.length === 4);

  const started = performance.now();
  assert.equal(await allowed.allows(path.join(root, "notes.txt")), true);
  assert.ok(performance.now() - started < 1_000, "an inside check finishes while every slow-path slot is stuck");

  let reprepared;
  void access.prepare([root, laterRoot]).then((value) => (reprepared = value));
  const deadline = performance.now() + 1_000;
  while (!reprepared && performance.now() < deadline) await new Promise((resolve) => setImmediate(resolve));
  assert.ok(reprepared, "a changed root list is prepared while every slow-path slot is stuck");
  assert.equal(await reprepared.allows(path.join(laterRoot, "notes.txt")), true);

  const fifth = allowed.allows(path.join(stalledMount, "e", "file.txt"));
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(2_000);
  assert.equal(await fifth, false, "a fifth outside check gives up at the two second limit");
  assert.equal(stalled.length, 4, "the fifth check never started another disk lookup");
  assert.deepEqual(await Promise.all(slow), [false, false, false, false]);
});
