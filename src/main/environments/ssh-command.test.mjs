import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { runLocalSshTool } from "./ssh-command.ts";

test("local SSH tools receive physical cwd and system PATH while preserving redacted OS failures", async (t) => {
  let options;
  let code;
  const cause = new Error("tool failed");
  t.mock.method(childProcess, "execFile", (_executable, _args, configuration, callback) => {
    options = configuration;
    cause.code = code;
    cause.syscall = "spawn ssh-keygen";
    callback(cause, "", "ssh tool failed token=ssh-private");
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  for (code of ["ENOENT", "ENOTDIR", "EACCES"]) {
    await assert.rejects(runLocalSshTool("ssh-keygen", ["-F", "test"]), (error) => {
      assert.equal(error.cause, cause);
      assert.ok(error.message.includes(code));
      assert.ok(!error.message.includes("ssh-private"));
      if (code === "ENOENT") assert.ok(error.message.includes("SSH executable is unavailable"));
      assert.ok(error.message.includes("ssh tool failed"));
      return true;
    });
    assert.equal(options.cwd, fs.realpathSync.native(os.homedir()));
    assert.ok(path.isAbsolute(options.cwd));
    assert.ok(Object.entries(options.env).some(([key, value]) => key.toLowerCase() === "path" && value));
  }
});
