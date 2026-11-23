import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { createDeferred } from "#test-timing";
import { importTestBundle } from "#test-bundle";

const base = mkdtempSync(path.join(tmpdir(), "dexon-real-roots-"));
const env = new Map(["PI_CODING_AGENT_DIR", "PI_CODING_AGENT_SESSION_DIR"].map((name) => [name, process.env[name]]));
process.env.PI_CODING_AGENT_DIR = path.join(base, "agent");
process.env.PI_CODING_AGENT_SESSION_DIR = path.join(base, "sessions");
mkdirSync(process.env.PI_CODING_AGENT_SESSION_DIR, { recursive: true });
after(() => {
  for (const [name, value] of env) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  rmSync(base, { recursive: true, force: true });
});
const {
  allowFileRoot,
  assertPathAllowed,
  createPathAccess,
  getAllowedFileRoots,
  invalidateAllowedRootsCache,
  isFilePathAllowed,
  setAllowedRootsWatcherHealthy,
  setGitCommandRunner,
} = await importTestBundle("real-file-roots-cache", {
  packages: "external",
  stdin: {
    contents:
      'export {allowFileRoot, assertPathAllowed, getAllowedFileRoots, invalidateAllowedRootsCache, isFilePathAllowed, setAllowedRootsWatcherHealthy} from "./file-access.ts"; export {createPathAccess} from "./file-access-core.ts"; export {setGitCommandRunner} from "../shared/worktree.ts";',
    resolveDir: import.meta.dirname,
    loader: "ts",
  },
});

test("a directory change during a real session scan cannot publish stale allowed roots", async (t) => {
  const stale = path.join(base, "stale");
  const fresh = path.join(base, "fresh");
  mkdirSync(stale);
  mkdirSync(fresh);
  const file = path.join(process.env.PI_CODING_AGENT_SESSION_DIR, "fixture.jsonl");
  const writeSession = (cwd) =>
    writeFileSync(
      file,
      JSON.stringify({ type: "session", version: 3, id: "fixture", cwd, timestamp: "2026-08-06T00:00:00.000Z" }) + "\n",
    );
  writeSession(stale);
  const enteredGit = createDeferred();
  const releaseGit = createDeferred();
  let delayed = false;
  // Keep session parsing and files real; pause only the external Git command
  // so the watcher invalidation lands in the middle of the public roots scan.
  const restoreGit = setGitCommandRunner({
    async run(cwd) {
      if (cwd === stale && !delayed) {
        delayed = true;
        enteredGit.resolve();
        await releaseGit.promise;
      }
      throw new Error("fixture directory is not a Git repository");
    },
  });
  t.after(() => {
    releaseGit.resolve();
    restoreGit();
    setAllowedRootsWatcherHealthy(false);
    invalidateAllowedRootsCache();
  });
  setAllowedRootsWatcherHealthy(true);
  invalidateAllowedRootsCache();
  const scanning = getAllowedFileRoots();
  await enteredGit.promise;
  writeSession(fresh);
  invalidateAllowedRootsCache();
  releaseGit.resolve();
  const scanned = await createPathAccess().prepare(await scanning);
  assert.equal(await scanned.allows(path.join(fresh, "notes.txt")), true);
  assert.equal(await scanned.allows(path.join(stale, "notes.txt")), false);
  assert.equal(await isFilePathAllowed(path.join(fresh, "notes.txt")), true);
  assert.equal(
    await isFilePathAllowed(path.join(stale, "notes.txt")),
    false,
    "the next caller cannot read a cached stale directory",
  );
});

test("denies daemon and desktop secret and auth state files even when the state directory is an allowed root", async (t) => {
  const stateDir = mkdtempSync(path.join(tmpdir(), "dexon-protected-state-"));
  const previous = process.env.PI_DESKTOP_USER_DATA;
  process.env.PI_DESKTOP_USER_DATA = stateDir;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_DESKTOP_USER_DATA;
    else process.env.PI_DESKTOP_USER_DATA = previous;
    invalidateAllowedRootsCache();
    rmSync(stateDir, { recursive: true, force: true });
  });
  allowFileRoot(stateDir);
  invalidateAllowedRootsCache();
  const normalFile = path.join(stateDir, "notes.txt");
  writeFileSync(normalFile, "ok");
  assert.equal(await isFilePathAllowed(normalFile), true);
  await assertPathAllowed(normalFile);
  for (const name of [
    "auth-token",
    "automation.secrets.json",
    "channels.secrets.json",
    "credentials.vault.json",
    "daemon-owner.lock",
    "automation.secrets.json.123.tmp",
  ]) {
    const file = path.join(stateDir, name);
    writeFileSync(file, "private");
    assert.equal(await isFilePathAllowed(file), false, name);
    await assert.rejects(assertPathAllowed(file), (error) => error.code === "FORBIDDEN");
  }
});
