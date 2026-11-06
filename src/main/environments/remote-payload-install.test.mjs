import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { create as createTar } from "tar";
import { buildPayloadInstallScript } from "./remote-provisioner.ts";
const execute = promisify(execFile);

test("streamed payload installation verifies bytes before publishing an immutable complete runtime", async (t) => {
  if (process.platform === "win32") return t.skip("Payload installation runs in a POSIX remote shell");
  const directory = mkdtempSync(path.join(tmpdir(), "dexon-payload-install-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const content = path.join(directory, "content");
  mkdirSync(content);
  writeFileSync(path.join(content, "index.mjs"), 'process.stdout.write("payload-v1");\n');
  const archive = path.join(directory, "payload.tar.gz");
  await createTar({ cwd: content, gzip: true, file: archive }, ["index.mjs"]);
  const bytes = readFileSync(archive);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const remoteStateDir = path.join(directory, "state's files");
  const target = { kind: "ssh", sshAlias: "fixture", remoteStateDir };
  const install = async (version, sha256) => {
    const script = buildPayloadInstallScript(target, process.execPath, version, { sha256 });
    const execution = execute("sh", ["-c", script], { timeout: 10000 });
    execution.child.stdin.end(bytes);
    return execution;
  };
  await install("v1", digest);
  const installed = await execute(process.execPath, [path.join(remoteStateDir, "runtime", "v1", "index.mjs")]);
  assert.equal(installed.stdout, "payload-v1");
  assert.equal(readFileSync(path.join(remoteStateDir, "runtime", "v1", ".complete"), "utf8"), "");
  await install("v1", digest);
  await assert.rejects(install("v2", "0".repeat(64)), /checksum/);
  assert.deepEqual(readdirSync(path.join(remoteStateDir, "runtime")), ["v1"]);
});
