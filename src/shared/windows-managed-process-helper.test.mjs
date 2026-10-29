import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, chmod, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { clearInterval, setInterval } from "node:timers";
import {
  resolveWindowsManagedProcessHelper,
  verifyWindowsManagedProcessHelperReplaceable,
} from "./windows-managed-process-helper.ts";

async function fixture(packaged = false) {
  const root = await mkdtemp(path.join(tmpdir(), "pi-helper-resolution-"));
  const directory = packaged
    ? path.join(root, "managed-process", "win32-x64")
    : path.join(root, "out", "native", "windows-managed-process-helper");
  await mkdir(directory, { recursive: true });
  const bytes = Buffer.from("fixed helper bytes");
  const manifest = {
    schemaVersion: 1,
    protocolVersion: 1,
    buildId: "pimpd-0.1.13-p1-abcdef123456",
    arch: "x64",
    provenance: "windows-native-dev",
    file: "pi-managed-process-helper.exe",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sourceRevision: "abcdef123456",
    targetTriple: "x86_64-pc-windows-msvc",
  };
  await writeFile(path.join(directory, manifest.file), bytes);
  await writeFile(path.join(directory, "manifest.json"), JSON.stringify(manifest));
  return { root, directory, manifest, bytes };
}

async function executableFixture(script) {
  const root = await mkdtemp(path.join(tmpdir(), "pi-helper-resolution-"));
  const directory = path.join(root, "out", "native", "windows-managed-process-helper");
  await mkdir(directory, { recursive: true });
  const bytes = Buffer.from(script);
  const manifest = {
    schemaVersion: 1,
    protocolVersion: 1,
    buildId: "pimpd-0.1.13-p1-abcdef123456",
    arch: "x64",
    provenance: "windows-native-dev",
    file: "pi-managed-process-helper.exe",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sourceRevision: "abcdef123456",
    targetTriple: "x86_64-pc-windows-msvc",
  };
  const file = path.join(directory, manifest.file);
  await writeFile(file, bytes);
  await chmod(file, 0o755);
  await writeFile(path.join(directory, "manifest.json"), JSON.stringify(manifest));
  return { root, directory, manifest, file };
}

const helperVersion = (buildId) =>
  JSON.stringify({ protocolVersion: 1, buildId, arch: "x64", provenance: "windows-native-dev" });

function resolveFrom(root) {
  return resolveWindowsManagedProcessHelper({ isPackaged: false, resourcesPath: root, projectRoot: root });
}

test("Windows helper resolution accepts only the fixed development or packaged directory", async () => {
  const development = await fixture(false);
  const dev = resolveWindowsManagedProcessHelper({
    isPackaged: false,
    resourcesPath: "C:\\ignored",
    projectRoot: development.root,
    verifyExecutable: false,
  });
  assert.equal(dev.ok, true);
  assert.equal(dev.descriptor.path, await realpath(path.join(development.directory, development.manifest.file)));

  const packaged = await fixture(true);
  const release = resolveWindowsManagedProcessHelper({
    isPackaged: true,
    resourcesPath: packaged.root,
    projectRoot: "C:\\ignored",
    verifyExecutable: false,
  });
  assert.equal(release.ok, true);
  assert.equal(release.descriptor.path, await realpath(path.join(packaged.directory, packaged.manifest.file)));
});

test("Windows helper resolution fails closed on manifest drift and byte tampering", async () => {
  const value = await fixture(false);
  await writeFile(path.join(value.directory, "manifest.json"), JSON.stringify({ ...value.manifest, extra: true }));
  assert.deepEqual(
    resolveWindowsManagedProcessHelper({
      isPackaged: false,
      resourcesPath: value.root,
      projectRoot: value.root,
      verifyExecutable: false,
    }),
    { ok: false, errorCode: "HELPER_INTEGRITY", reason: "content-mismatch" },
  );
  await writeFile(path.join(value.directory, "manifest.json"), JSON.stringify(value.manifest));
  await writeFile(path.join(value.directory, value.manifest.file), Buffer.from("tampered"));
  assert.deepEqual(
    resolveWindowsManagedProcessHelper({
      isPackaged: false,
      resourcesPath: value.root,
      projectRoot: value.root,
      verifyExecutable: false,
    }),
    { ok: false, errorCode: "HELPER_INTEGRITY", reason: "content-mismatch" },
  );
});

test(
  "a helper that needs 3 seconds to answer its version check is accepted",
  { skip: process.platform === "win32", timeout: 30_000 },
  async () => {
    const value = await executableFixture(
      `#!/bin/sh\nsleep 3\nprintf '%s' '${helperVersion("pimpd-0.1.13-p1-abcdef123456")}'\n`,
    );
    const result = resolveFrom(value.root);
    assert.equal(result.ok, true);
  },
);

test(
  "a helper that never answers its version check is reported as a version-check timeout",
  { skip: process.platform === "win32", timeout: 30_000 },
  async () => {
    const value = await executableFixture("#!/bin/sh\nexec sleep 30\n");
    const started = Date.now();
    const result = resolveFrom(value.root);
    const elapsed = Date.now() - started;
    assert.deepEqual(result, {
      ok: false,
      errorCode: "HELPER_INTEGRITY",
      reason: "version-check-timeout",
    });
    assert.ok(
      elapsed >= 9_000 && elapsed < 20_000,
      `the version check waited about 10 seconds before giving up (waited ${elapsed} ms)`,
    );
  },
);

test(
  "a helper that crashes during its version check is reported as a run failure",
  { skip: process.platform === "win32", timeout: 30_000 },
  async () => {
    const value = await executableFixture("#!/bin/sh\nexit 3\n");
    assert.deepEqual(resolveFrom(value.root), {
      ok: false,
      errorCode: "HELPER_INTEGRITY",
      reason: "version-check-failed",
    });
  },
);

test(
  "a helper that reports a different build is reported as a content mismatch",
  { skip: process.platform === "win32", timeout: 30_000 },
  async () => {
    const value = await executableFixture(
      `#!/bin/sh\nprintf '%s' '${helperVersion("pimpd-0.1.13-p1-000000000000")}'\n`,
    );
    assert.deepEqual(resolveFrom(value.root), {
      ok: false,
      errorCode: "HELPER_INTEGRITY",
      reason: "content-mismatch",
    });
  },
);

test("Windows update gate proves the fixed helper can be atomically moved and restored", async () => {
  const value = await fixture(false);
  const resolution = resolveWindowsManagedProcessHelper({
    isPackaged: false,
    resourcesPath: value.root,
    projectRoot: value.root,
    verifyExecutable: false,
  });
  assert.equal(resolution.ok, true);
  assert.equal(verifyWindowsManagedProcessHelperReplaceable(resolution.descriptor), true);
  assert.deepEqual(await readFile(resolution.descriptor.path), value.bytes);
});

test("Windows update gate fails closed when the helper is locked and never starts a move", async () => {
  const value = await fixture(false);
  const resolution = resolveWindowsManagedProcessHelper({
    isPackaged: false,
    resourcesPath: value.root,
    projectRoot: value.root,
    verifyExecutable: false,
  });
  assert.equal(resolution.ok, true);
  assert.equal(
    verifyWindowsManagedProcessHelperReplaceable(resolution.descriptor, () => {
      const error = new Error("sharing violation");
      error.code = "EPERM";
      throw error;
    }),
    false,
  );
  assert.deepEqual(await readFile(resolution.descriptor.path), value.bytes);
});

test(
  "Windows update gate rejects a real sharing lock and succeeds after release",
  { skip: process.platform !== "win32", timeout: 10_000 },
  async () => {
    const value = await fixture(false);
    const resolution = resolveWindowsManagedProcessHelper({
      isPackaged: false,
      resourcesPath: value.root,
      projectRoot: value.root,
      verifyExecutable: false,
    });
    assert.equal(resolution.ok, true);
    const script = [
      `$stream=[System.IO.File]::Open(${JSON.stringify(resolution.descriptor.path)},[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::Read)`,
      '[Console]::Out.WriteLine("LOCKED")',
      "[Console]::In.ReadLine()|Out-Null",
      "$stream.Dispose()",
    ].join(";");
    const locker = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    locker.stdout.on("data", (chunk) => {
      output += chunk.toString("utf8");
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("sharing lock did not become ready")), 5_000);
      const poll = setInterval(() => {
        if (!output.includes("LOCKED")) return;
        clearTimeout(timer);
        clearInterval(poll);
        resolve();
      }, 20);
      locker.once("error", reject);
    });
    assert.equal(verifyWindowsManagedProcessHelperReplaceable(resolution.descriptor), false);
    locker.stdin.end("release\n");
    assert.equal(await new Promise((resolve) => locker.once("exit", resolve)), 0);
    assert.equal(verifyWindowsManagedProcessHelperReplaceable(resolution.descriptor), true);
  },
);
