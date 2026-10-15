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
const { getAllowedFileRoots, invalidateAllowedRootsCache, setAllowedRootsWatcherHealthy, setGitCommandRunner } =
  await importTestBundle("real-file-roots-cache", {
    packages: "external",
    stdin: {
      contents:
        'export {getAllowedFileRoots, invalidateAllowedRootsCache, setAllowedRootsWatcherHealthy} from "./file-access.ts"; export {setGitCommandRunner} from "../shared/worktree.ts";',
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
  const roots = await scanning;
  assert.equal(roots.has(fresh), true);
  assert.equal(roots.has(stale), false);
  const following = await getAllowedFileRoots();
  assert.equal(following.has(fresh), true);
  assert.equal(following.has(stale), false, "the next caller cannot read a cached stale directory");
});
