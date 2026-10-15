import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createElectronTestEnvironment } from "./electron-test-environment.mjs";

// Observe real child-process filesystem paths, not the launcher's source text.
test("a native child keeps its home, Agent and sessions inside its disposable environment", (t) => {
  const inherited = mkdtempSync(path.join(tmpdir(), "dexon-parent-home-"));
  t.after(() => rmSync(inherited, { recursive: true, force: true }));
  const sandbox = createElectronTestEnvironment({
    ...process.env,
    HOME: inherited,
    USERPROFILE: inherited,
    PI_CODING_AGENT_DIR: path.join(inherited, "agent"),
    PI_CODING_AGENT_SESSION_DIR: path.join(inherited, "sessions"),
  });
  t.after(() => sandbox.dispose());
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
      import {homedir} from 'node:os';
      import {mkdirSync, writeFileSync} from 'node:fs';
      import path from 'node:path';
      import {getAgentDir} from '@earendil-works/pi-coding-agent';
      const paths = {home:homedir(), agent:getAgentDir(), sessions:process.env.PI_CODING_AGENT_SESSION_DIR};
      for (const directory of Object.values(paths)) {
        mkdirSync(directory, {recursive:true});
        writeFileSync(path.join(directory, 'isolation-probe.txt'), 'temporary data');
      }
      console.log(JSON.stringify(paths));
    `,
    ],
    { cwd: path.resolve(import.meta.dirname, ".."), env: sandbox.env, encoding: "utf8" },
  );
  assert.equal(child.status, 0, child.stderr);
  const paths = JSON.parse(child.stdout.trim());
  for (const [name, directory] of Object.entries(paths)) {
    const relative = path.relative(sandbox.directory, directory);
    assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative), `${name} escaped the sandbox`);
    assert.equal(existsSync(path.join(directory, "isolation-probe.txt")), true);
  }
  assert.equal(existsSync(path.join(inherited, "isolation-probe.txt")), false, "the inherited home is untouched");
  sandbox.dispose();
  assert.equal(existsSync(sandbox.directory), false, "all child data is removed with its environment");
});

test("a native child cannot populate an inherited user's compilation cache", (t) => {
  const parent = mkdtempSync(path.join(tmpdir(), "dexon-parent-cache-"));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const inheritedCache = path.join(parent, "user-compile-cache");
  const sandbox = createElectronTestEnvironment({ ...process.env, NODE_COMPILE_CACHE: inheritedCache });
  t.after(() => sandbox.dispose());
  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", "import {enableCompileCache} from 'node:module'; enableCompileCache();"],
    { env: sandbox.env, encoding: "utf8" },
  );
  assert.equal(child.status, 0, child.stderr);
  assert.equal(existsSync(inheritedCache), false, "a test child must not create the user's inherited cache");
  sandbox.dispose();
  assert.equal(existsSync(sandbox.directory), false);
});
