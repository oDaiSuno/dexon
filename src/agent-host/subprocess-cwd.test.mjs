import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as boundary from "./subprocess-cwd.ts";

test("subprocess cwd rejects archive segments before and after resolving symlinks", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cwd-boundary-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const archive = path.join(root, "APP.ASAR", "child");
  const unpacked = path.join(root, "app.asar.unpacked");
  fs.mkdirSync(archive, { recursive: true });
  fs.mkdirSync(unpacked);
  const alias = path.join(root, "alias");
  fs.symlinkSync(path.dirname(archive), alias, process.platform === "win32" ? "junction" : "dir");
  const home = fs.realpathSync.native(os.homedir());
  assert.equal(boundary.resolveSafeProcessCwd(archive), home);
  assert.equal(boundary.resolveSafeProcessCwd(alias), home);
  assert.equal(boundary.resolveSafeProcessCwd(path.join(root, "missing")), home);
  assert.equal(boundary.resolveSafeProcessCwd("relative"), home);
  assert.equal(boundary.resolveSafeProcessCwd(unpacked), fs.realpathSync.native(unpacked));
});

test("cwd fallback verifies temp when home is missing and never returns an unverified path", (t) => {
  const temp = fs.realpathSync.native(os.tmpdir());
  t.mock.method(os, "homedir", () => path.join(temp, "missing-home-cwd-boundary"));
  assert.equal(boundary.resolveSafeProcessCwd(), temp);
  t.mock.method(os, "tmpdir", () => path.join(temp, "missing-temp-cwd-boundary"));
  assert.throws(
    () => boundary.resolveSafeProcessCwd(),
    (error) => error.cause?.code === "ENOENT",
  );
});

test("system tool PATH retains custom entries and appends platform defaults without duplicates", () => {
  assert.equal(typeof boundary.withSystemToolPath, "function");
  const original = { PATH: "/custom:/usr/bin" };
  assert.equal(
    boundary.withSystemToolPath(original, "darwin").PATH,
    "/custom:/usr/bin:/opt/homebrew/bin:/usr/local/bin:/bin:/usr/sbin:/sbin",
  );
  assert.equal(
    boundary.withSystemToolPath(original, "linux").PATH,
    "/custom:/usr/bin:/usr/local/bin:/bin:/usr/sbin:/sbin",
  );
  const windows = boundary.withSystemToolPath(
    { Path: "C:\\custom", PATH: "c:\\CUSTOM;C:\\tools", SystemRoot: "C:\\Windows" },
    "win32",
  );
  assert.equal(windows.Path, "C:\\custom;C:\\tools;C:\\Windows\\System32\\OpenSSH;C:\\Windows\\System32");
  assert.equal("PATH" in windows, false);
  assert.equal(boundary.withSystemToolPath({ SystemRoot: "C:\\app.asar" }, "win32").Path, "");
  assert.deepEqual(original, { PATH: "/custom:/usr/bin" });
});

test("OS diagnostics follow causes, reject numeric exits, and redact credentials before taking the tail", () => {
  assert.equal(typeof boundary.osErrorFacts, "function");
  const cause = Object.assign(new Error("bad cwd"), { code: "ENOTDIR", syscall: "spawn" });
  assert.deepEqual(boundary.osErrorFacts(Object.assign(new Error("wrapper", { cause }), { code: 1 })), {
    code: "ENOTDIR",
    syscall: "spawn",
  });
  assert.equal(boundary.osErrorFacts({ code: 127 }), undefined);
  assert.deepEqual(boundary.osErrorFacts({ cause: { code: "ENOENT" } }), { code: "ENOENT" });
  const cycle = {};
  cycle.cause = cycle;
  assert.equal(boundary.osErrorFacts(cycle), undefined);
  assert.equal(boundary.formatOsErrorFacts({ code: "EACCES", syscall: "spawn ssh" }), "EACCES, spawn ssh");
  const diagnostic =
    'https://alice:password@example.com Bearer abcdef {"api_key":"hidden value"} token=abc secret: def NODE_AUTH_TOKEN=ghi npm_abc ghp_def sk-123456789 ENOTDIR';
  const redacted = boundary.redactDiagnostic(diagnostic);
  for (const secret of [
    "alice",
    "password@",
    "abcdef",
    "hidden value",
    "=abc",
    ": def",
    "=ghi",
    "npm_abc",
    "ghp_def",
    "sk-123456789",
  ])
    assert.ok(!redacted.includes(secret), redacted);
  assert.ok(redacted.includes("ENOTDIR"));
  assert.equal(boundary.redactDiagnostic(`token=${"a".repeat(2048)} ENOENT`, 30), "token=[redacted] ENOENT");
  assert.equal(boundary.redactDiagnostic("a".repeat(2048)).length, 1024);
});

test("diagnostic redaction consumes escaped JSON secrets and Basic authorization values", () => {
  const diagnostic = `${JSON.stringify({ password: 'escaped"private-tail' })} authorization: Basic confidential-value`;
  const redacted = boundary.redactDiagnostic(diagnostic);
  assert.ok(!redacted.includes("private-tail"), redacted);
  assert.ok(!redacted.includes("confidential-value"), redacted);
});
