import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { IsolatedJobError, runIsolatedNodeJob } from "./isolated-node-job.ts";

const options = {
  entryPath: "unused",
  input: {},
  marker: "RESULT:",
  timeoutMs: 5000,
  maxInputBytes: 1024,
  env: process.env,
};

test("isolated jobs use a verified physical cwd even when the requested directory is an archive", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "isolated-cwd-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const archive = path.join(root, "app.asar");
  fs.mkdirSync(archive);
  const entryPath = path.join(root, "worker.mjs");
  fs.writeFileSync(
    entryPath,
    'process.stdin.resume(); process.stdout.write("RESULT:" + Buffer.from(JSON.stringify(process.cwd())).toString("base64") + "\\n");',
  );
  assert.equal(await runIsolatedNodeJob({ ...options, entryPath, cwd: archive }), fs.realpathSync.native(os.homedir()));
});

test("isolated spawn errors retain OS cause facts", async () => {
  for (const code of ["ENOTDIR", "ENOENT", "EACCES"]) {
    const cause = Object.assign(new Error("spawn failed"), { code, syscall: "spawn node" });
    await assert.rejects(
      runIsolatedNodeJob({
        ...options,
        spawnProcess: () => {
          throw cause;
        },
      }),
      (error) =>
        error instanceof IsolatedJobError &&
        error.code === code &&
        error.syscall === "spawn node" &&
        error.message.includes(code) &&
        error.cause === cause,
    );
  }
});

test("isolated crash stderr retains the cause without credentials", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "isolated-error-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const entryPath = path.join(root, "worker.mjs");
  fs.writeFileSync(
    entryPath,
    'process.stdin.resume(); process.stderr.write("catalog ENOTDIR token=private Bearer confidential https://user:pass@example.com"); process.exitCode = 1;',
  );
  await assert.rejects(
    runIsolatedNodeJob({ ...options, entryPath }),
    (error) => error.message.includes("ENOTDIR") && !/private|confidential|user:pass/.test(error.message),
  );
});

test("real OS executable lookup failures retain ENOENT and ENOTDIR", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "isolated-os-cause-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "file"), "not a directory");
  const failures = [[path.join(root, "missing"), "ENOENT"]];
  if (process.platform !== "win32") failures.push([path.join(root, "file", "node"), "ENOTDIR"]);
  for (const [execPath, code] of failures) {
    await assert.rejects(
      runIsolatedNodeJob({ ...options, execPath }),
      (error) => error.code === code && error.message.includes(code),
    );
  }
});
