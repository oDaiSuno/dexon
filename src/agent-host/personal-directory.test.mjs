import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..", "..");
const { personalDirectoryPath, preparePersonalDirectory } = await importTestBundle(
  "src/agent-host/personal-directory",
  {
    absWorkingDir: root,
    entryPoints: ["src/agent-host/personal-directory.ts"],
  },
);

const isWindowsHost = process.platform === "win32";
// POSIX permission bits do not gate directory creation on Windows; the
// chmod-based failure scenarios are verified with controlled fs stubs on all
// platforms and against a real filesystem only where POSIX semantics hold.
const posixPermissionSemantics = !isWindowsHost;

function makeTempHome(t) {
  const home = mkdtempSync(path.join(tmpdir(), "dexon-personal-home-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return home;
}

test("personal directory paths follow platform rules without hardcoding a username or dates", () => {
  assert.equal(personalDirectoryPath("C:\\Users\\mira"), "C:\\Users\\mira\\.dexon");
  assert.equal(personalDirectoryPath("C:/Users/mira"), "C:\\Users\\mira\\.dexon");
  assert.equal(personalDirectoryPath("\\\\server\\share"), "\\\\server\\share\\.dexon");
  assert.doesNotMatch(personalDirectoryPath("C:\\Users\\mira"), /\d{8}/);
  // Non-Windows-shaped homes join under the host platform's rules: forward
  // slashes on POSIX, backslashes on Windows. The win32 branch above stays
  // lexical on every host.
  const expected = isWindowsHost ? "\\Users\\mira\\.dexon" : "/Users/mira/.dexon";
  assert.equal(personalDirectoryPath("/Users/mira"), expected);
});

test("preparing a fresh home creates .dexon exactly once and reports not reused", (t) => {
  const home = makeTempHome(t);
  const first = preparePersonalDirectory({ home });
  assert.deepEqual(
    { ok: first.ok, path: first.path, reused: first.ok ? first.reused : undefined },
    { ok: true, path: path.join(home, ".dexon"), reused: false },
  );
  const second = preparePersonalDirectory({ home });
  assert.equal(second.ok, true);
  assert.equal(second.ok ? second.path : "", first.ok ? first.path : "");
  assert.equal(second.ok ? second.reused : false, true);
});

test("repeated preparation reuses the same directory without clearing content", (t) => {
  const home = makeTempHome(t);
  const directory = path.join(home, ".dexon");
  mkdirSync(directory);
  writeFileSync(path.join(directory, "keep.txt"), "v1", "utf8");

  const first = preparePersonalDirectory({ home });
  const second = preparePersonalDirectory({ home });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.ok ? second.reused : false, true);
  if (first.ok && second.ok) assert.equal(second.path, first.path);
  assert.equal(readFileSync(path.join(directory, "keep.txt"), "utf8"), "v1");
});

test("a same-name regular file is never overwritten and the conflict is retryable", (t) => {
  const home = makeTempHome(t);
  const blocked = path.join(home, ".dexon");
  writeFileSync(blocked, "precious-bytes", "utf8");

  const blockedResult = preparePersonalDirectory({ home });
  assert.deepEqual(blockedResult.ok, false);
  if (blockedResult.ok) return;
  assert.equal(blockedResult.reason, "not-directory");
  assert.match(blockedResult.error, /not a directory/);
  assert.equal(readFileSync(blocked, "utf8"), "precious-bytes");

  rmSync(blocked);
  const retry = preparePersonalDirectory({ home });
  assert.equal(retry.ok, true);
  assert.equal(retry.ok ? retry.reused : true, false);
});

test("an unresolvable realpath is a real failure, never a silent success", () => {
  // The directory exists, but realpath cannot confirm it: preparation must
  // fail with the real cause instead of authorizing an unresolved path.
  const scriptedFs = {
    statSync: () => ({ isDirectory: () => true }),
    mkdirSync: () => undefined,
    realpathSync: () => {
      const error = new Error("I/O error while resolving .dexon");
      error.code = "EIO";
      throw error;
    },
  };
  const result = preparePersonalDirectory({ home: "/review/home", fs: scriptedFs });
  assert.deepEqual(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "prepare-failed");
  assert.match(result.error, /I\/O error/);
});

test("a directory that disappears between stat and realpath resolution fails honestly", () => {
  const canonical = personalDirectoryPath("/review/canonical");
  const scriptedFs = {
    statSync: (filePath) => {
      if (filePath === canonical) {
        // The canonical target vanished after realpath succeeded.
        const error = new Error("no such file or directory");
        error.code = "ENOENT";
        throw error;
      }
      return { isDirectory: () => true };
    },
    mkdirSync: () => undefined,
    realpathSync: () => canonical,
  };
  const result = preparePersonalDirectory({ home: "/review/home", fs: scriptedFs });
  assert.deepEqual(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "prepare-failed");
});

test("a racing caller that completes the directory first is reported as reuse", () => {
  // stat reports ENOENT, mkdir finds the directory already present (returns
  // undefined), and strict resolution confirms it: reused must be true.
  const directory = personalDirectoryPath("/review/home");
  const canonical = personalDirectoryPath("/review/canonical");
  const scriptedFs = {
    statSync: (filePath) => {
      if (filePath === directory) {
        const error = new Error("no such file or directory");
        error.code = "ENOENT";
        throw error;
      }
      return { isDirectory: () => true };
    },
    mkdirSync: () => undefined,
    realpathSync: () => canonical,
  };
  const result = preparePersonalDirectory({ home: "/review/home", fs: scriptedFs });
  assert.deepEqual(result, {
    ok: true,
    path: directory,
    canonicalPath: canonical,
    reused: true,
  });
});

test("a same-name file appearing mid-flight is classified as a conflict without touching it", () => {
  const directory = personalDirectoryPath("/review/home");
  let statCalls = 0;
  const scriptedFs = {
    statSync: (filePath) => {
      if (filePath === directory) {
        statCalls += 1;
        if (statCalls === 1) {
          // Pre-create stat: nothing there yet.
          const error = new Error("no such file or directory");
          error.code = "ENOENT";
          throw error;
        }
        // Post-mkdir-failure classification: a same-name file appeared.
        return { isDirectory: () => false };
      }
      return { isDirectory: () => false };
    },
    mkdirSync: () => {
      const error = new Error("EEXIST: file already exists");
      error.code = "EEXIST";
      throw error;
    },
    realpathSync: (filePath) => filePath,
  };
  const result = preparePersonalDirectory({ home: "/review/home", fs: scriptedFs });
  assert.deepEqual(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "not-directory");
  assert.match(result.error, /not a directory/);
});

test("mkdir failures that leave nothing behind surface the real cause", () => {
  const directory = personalDirectoryPath("/review/home");
  const scriptedFs = {
    statSync: (filePath) => {
      if (filePath === directory) {
        const error = new Error("no such file or directory");
        error.code = "ENOENT";
        throw error;
      }
      const error = new Error("permission denied");
      error.code = "EACCES";
      throw error;
    },
    mkdirSync: () => {
      const error = new Error("permission denied: /review/home/.dexon");
      error.code = "EACCES";
      throw error;
    },
    realpathSync: (filePath) => filePath,
  };
  const result = preparePersonalDirectory({ home: "/review/home", fs: scriptedFs });
  assert.deepEqual(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "prepare-failed");
  assert.match(result.error, /permission denied/);
});

test(
  "preparation failures against a real filesystem carry the real cause and succeed after the blocker is removed",
  { skip: posixPermissionSemantics ? false : "POSIX chmod semantics do not gate directory creation on Windows" },
  (t) => {
    const home = makeTempHome(t);
    chmodSync(home, 0o555);
    try {
      const failed = preparePersonalDirectory({ home });
      assert.deepEqual(failed.ok, false);
      if (failed.ok) return;
      assert.equal(failed.reason, "prepare-failed");
      assert.ok(failed.error.length > 0);
    } finally {
      chmodSync(home, 0o755);
    }
    const retry = preparePersonalDirectory({ home });
    assert.equal(retry.ok, true);
  },
);

test("a symlinked .dexon pointing at a directory is reused through its canonical target", (t) => {
  const home = makeTempHome(t);
  const target = mkdtempSync(path.join(tmpdir(), "dexon-personal-target-"));
  t.after(() => rmSync(target, { recursive: true, force: true }));
  writeFileSync(path.join(target, "marker.txt"), "linked", "utf8");
  symlinkSync(target, path.join(home, ".dexon"), isWindowsHost ? "junction" : undefined);

  const result = preparePersonalDirectory({ home });
  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.reused : false, true);
  if (result.ok) assert.equal(result.canonicalPath, realpathSync(target));
  assert.equal(readFileSync(path.join(target, "marker.txt"), "utf8"), "linked");
});
