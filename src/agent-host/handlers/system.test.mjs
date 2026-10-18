import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..", "..", "..");
const isolatedAgentDirectory = mkdtempSync(path.join(tmpdir(), "dexon-system-handlers-agent-"));
process.env.PI_CODING_AGENT_DIR = isolatedAgentDirectory;
process.env.PI_CODING_AGENT_SESSION_DIR = path.join(isolatedAgentDirectory, "sessions");
process.env.PI_OFFLINE = "1";
test.after(() => rmSync(isolatedAgentDirectory, { recursive: true, force: true }));

const { getAllowedFileRoots, getAllowedRootsGeneration, isFilePathAllowed, normalizeSlashes, registerHostHandlers } =
  await importTestBundle("src/agent-host/handlers/host-test", {
    stdin: {
      contents: `
        export { registerHostHandlers } from "./host.ts";
        export { getAllowedFileRoots } from "../file-access.ts";
        export { getAllowedRootsGeneration, normalizeSlashes } from "../../shared/allowed-roots.ts";
        export { isFilePathAllowed } from "../file-access-core.ts";
      `,
      resolveDir: import.meta.dirname,
      sourcefile: "host-handlers-test-entry.ts",
      loader: "ts",
    },
    packages: "external",
    absWorkingDir: root,
  });

// POSIX permission bits do not gate directory creation on Windows; the
// chmod-based INTERNAL-mapping scenario is verified only where POSIX
// semantics hold (the conflict and success paths stay cross-platform).
const posixPermissionSemantics = process.platform !== "win32";

function captureSystemHandlers(home) {
  const handlers = {};
  registerHostHandlers(
    {
      handle(next) {
        Object.assign(handlers, next);
      },
      emit() {},
    },
    { getHome: () => home },
  );
  return handlers;
}

function makeTempHome(t, label) {
  const home = mkdtempSync(path.join(tmpdir(), label));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return home;
}

test("defaultCwd prepares .dexon inside the injected home and authorizes exactly that root", async (t) => {
  const home = makeTempHome(t, "dexon-system-home-");
  const outside = makeTempHome(t, "dexon-system-outside-");
  const handlers = captureSystemHandlers(home);

  const result = await handlers["system.defaultCwd"]();
  assert.deepEqual(result, { cwd: path.join(home, ".dexon") });

  const roots = await getAllowedFileRoots();
  assert.equal(isFilePathAllowed(path.join(result.cwd, "notes", "deep", "plan.txt"), roots), true);
  assert.equal(isFilePathAllowed(path.join(home, "sibling.txt"), roots), false);
  assert.equal(isFilePathAllowed(path.join(outside, "elsewhere.txt"), roots), false);
});

test("repeated defaultCwd calls keep one authorized root and a stable generation", async (t) => {
  const home = makeTempHome(t, "dexon-system-home-");
  const handlers = captureSystemHandlers(home);

  const first = await handlers["system.defaultCwd"]();
  const generationAfterFirst = getAllowedRootsGeneration();
  const rootsAfterFirst = await getAllowedFileRoots();
  // allowFileRoot stores the canonical (realpath) form with normalized
  // slashes; compare against that exact stored shape.
  const authorizedRoot = normalizeSlashes(realpathSync.native(path.join(home, ".dexon")));
  const matchingRoots = [...rootsAfterFirst].filter((root) => root === authorizedRoot);
  assert.equal(matchingRoots.length, 1);

  const second = await handlers["system.defaultCwd"]();
  assert.deepEqual(second, first);
  assert.equal(getAllowedRootsGeneration(), generationAfterFirst);
});

test("defaultCwd reports a conflict when a same-name file blocks the directory", async (t) => {
  const home = makeTempHome(t, "dexon-system-home-");
  const blocked = path.join(home, ".dexon");
  writeFileSync(blocked, "do-not-touch", "utf8");
  const handlers = captureSystemHandlers(home);

  await assert.rejects(
    handlers["system.defaultCwd"](),
    (error) => error.code === "CONFLICT" && /not a directory/i.test(error.message),
  );
  assert.equal(readFileSync(blocked, "utf8"), "do-not-touch");
});

test(
  "defaultCwd surfaces real preparation failures and recovers on retry",
  { skip: posixPermissionSemantics ? false : "POSIX chmod semantics do not gate directory creation on Windows" },
  async (t) => {
    const home = makeTempHome(t, "dexon-system-home-");
    const handlers = captureSystemHandlers(home);
    chmodSync(home, 0o555);
    try {
      await assert.rejects(
        handlers["system.defaultCwd"](),
        (error) => error.code === "INTERNAL" && error.message.length > 0,
      );
    } finally {
      chmodSync(home, 0o755);
    }
    const retry = await handlers["system.defaultCwd"]();
    assert.deepEqual(retry, { cwd: path.join(home, ".dexon") });
  },
);

test("system.home reflects the injected home provider and preparation is repeatable", async (t) => {
  const home = makeTempHome(t, "dexon-system-home-");
  const handlers = captureSystemHandlers(home);

  assert.deepEqual(await handlers["system.home"](), { home });
  const first = await handlers["system.defaultCwd"]();
  const second = await handlers["system.defaultCwd"]();
  assert.deepEqual(second, first);
});
