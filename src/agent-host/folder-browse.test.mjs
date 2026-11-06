import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import test from "node:test";
import { browseFolders, readGitHead } from "./folder-browse.ts";
function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "dexon-folder-browse-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("directory browsing returns canonical child folders and branch badges without including files", async (t) => {
  const directory = fixture(t);
  mkdirSync(path.join(directory, "app", ".git"), { recursive: true });
  mkdirSync(path.join(directory, "empty"));
  writeFileSync(path.join(directory, "app", ".git", "HEAD"), "ref: refs/heads/feature/remote\n");
  writeFileSync(path.join(directory, "README.md"), "a file");
  const listing = await browseFolders(directory);
  assert.equal(listing.ok, true);
  assert.equal(listing.path, realpathSync.native(directory));
  assert.deepEqual(
    listing.folders.map(({ name, git }) => ({ name, git })),
    [
      { name: "app", git: { branch: "feature/remote", detached: false } },
      { name: "empty", git: null },
    ],
  );
  assert.equal(listing.folders[0].path, realpathSync.native(path.join(directory, "app")));
  assert.equal(listing.folders[0].displayPath, path.join(directory, "app"));
  assert.equal(listing.truncated, false);
});

test("branch badges follow relative worktree gitfiles and recognize detached HEAD", async (t) => {
  const directory = fixture(t);
  const worktree = path.join(directory, "worktree");
  const metadata = path.join(directory, "main", ".git", "worktrees", "feature");
  mkdirSync(worktree);
  mkdirSync(metadata, { recursive: true });
  writeFileSync(path.join(worktree, ".git"), "gitdir: ../main/.git/worktrees/feature\n");
  writeFileSync(path.join(metadata, "HEAD"), "ref: refs/heads/remote-ui\n");
  assert.deepEqual(await readGitHead(worktree), { branch: "remote-ui", detached: false });
  writeFileSync(path.join(metadata, "HEAD"), "a".repeat(40) + "\n");
  assert.deepEqual(await readGitHead(worktree), { branch: null, detached: true });
  writeFileSync(path.join(metadata, "HEAD"), "not a git ref\n");
  assert.equal(await readGitHead(worktree), null);
});

test("symlinked folders retain a recognizable display path while returning canonical identities", async (t) => {
  if (process.platform === "win32") return t.skip("Creating symlinks requires Windows privileges");
  const directory = fixture(t);
  const actual = path.join(directory, "actual");
  mkdirSync(actual);
  symlinkSync(actual, path.join(directory, "alias"));
  symlinkSync(path.join(directory, "missing"), path.join(directory, "broken"));
  const listing = await browseFolders(path.join(directory, "alias"));
  assert.equal(listing.path, realpathSync.native(actual));
  assert.equal(listing.displayPath, path.join(directory, "alias"));
  const parent = await browseFolders(directory);
  assert.deepEqual(
    parent.folders.map((entry) => entry.name),
    ["actual", "alias"],
  );
  assert.equal(parent.folders[1].path, realpathSync.native(actual));
});

test("invalid paths return typed errors and home expansion works", async (t) => {
  const directory = fixture(t);
  const file = path.join(directory, "file");
  writeFileSync(file, "text");
  assert.deepEqual(await browseFolders("relative"), { ok: false, path: "relative", error: "not-absolute" });
  assert.equal((await browseFolders(path.join(directory, "missing"))).error, "not-found");
  assert.equal((await browseFolders(file)).error, "not-directory");
  const home = await browseFolders("~");
  assert.equal(home.path, realpathSync.native(homedir()));
  assert.equal(home.displayPath, "~");
});

test("unreadable directories report permission errors instead of an empty successful listing", async (t) => {
  if (process.platform === "win32" || process.getuid?.() === 0)
    return t.skip("Permission enforcement requires a non-root POSIX account");
  const directory = fixture(t);
  const blocked = path.join(directory, "blocked");
  mkdirSync(blocked);
  chmodSync(blocked, 0);
  try {
    assert.equal((await browseFolders(blocked)).error, "permission-denied");
  } finally {
    chmodSync(blocked, 0o700);
  }
});
