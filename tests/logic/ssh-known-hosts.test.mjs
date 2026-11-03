import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { acceptHostKey, scanHostKey } from "../../src/agent-host/workspace/host/ssh/known-hosts.ts";

const fakeKeyscan = path.resolve(
  import.meta.dirname,
  "../../src/agent-host/workspace/testing/fake-ssh-keyscan-program.mjs",
);

function sandbox(t, scenario = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "dx-kh-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, "ssh-keyscan");
  writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${fakeKeyscan}" "$@"\n`);
  chmodSync(bin, 0o755);
  const scenarioFile = path.join(root, "scenario.json");
  writeFileSync(scenarioFile, JSON.stringify(scenario));
  const previous = process.env.DEXON_FAKE_SSH_SCENARIO;
  process.env.DEXON_FAKE_SSH_SCENARIO = scenarioFile;
  t.after(() => {
    if (previous === undefined) delete process.env.DEXON_FAKE_SSH_SCENARIO;
    else process.env.DEXON_FAKE_SSH_SCENARIO = previous;
  });
  return { root, keyscan: bin, knownHosts: path.join(root, "ssh", "known_hosts") };
}

const ED25519_BLOB = "AAAAC3NzaC1lZDI1NTE5AAAAILTeFB4/nzVyeC8AD1sIm+msF3j0rgd+XKKJAaq8vRox";
const ED25519_FINGERPRINT = "SHA256:QcjPMXAGmZOxtyxxTZeE2UcJvOdrsr2U2r4yHQkXLm0";

test("scanning an unknown server reports the SHA256 fingerprint and key type ssh itself would print", async (t) => {
  const { keyscan } = sandbox(t);
  const scanned = await scanHostKey({ host: "prod-vps", port: 2222 }, { keyscanBinary: keyscan });
  assert.equal(scanned.keyType, "ED25519");
  assert.equal(scanned.fingerprint, ED25519_FINGERPRINT);
  assert.equal(scanned.rawHostKeyLine, `[prod-vps]:2222 ssh-ed25519 ${ED25519_BLOB}`);
});

test("accepting a host key stores the scanned key owner-only and a second accept does not duplicate it", async (t) => {
  const { keyscan, knownHosts } = sandbox(t);
  const target = { host: "prod-vps", port: 2222 };
  await acceptHostKey(target, ED25519_FINGERPRINT, { keyscanBinary: keyscan, knownHostsPath: knownHosts });
  await acceptHostKey(target, ED25519_FINGERPRINT, { keyscanBinary: keyscan, knownHostsPath: knownHosts });
  assert.equal(readFileSync(knownHosts, "utf8"), `[prod-vps]:2222 ssh-ed25519 ${ED25519_BLOB}\n`);
  if (process.platform !== "win32") assert.equal(statSync(knownHosts).mode & 0o777, 0o600);
});

test("a fingerprint the server does not present is refused and nothing is written", async (t) => {
  const { keyscan, knownHosts } = sandbox(t);
  await assert.rejects(
    acceptHostKey({ host: "prod-vps" }, "SHA256:attackerChosenValue", {
      keyscanBinary: keyscan,
      knownHostsPath: knownHosts,
    }),
    (error) => error.code === "FINGERPRINT_MISMATCH",
  );
  assert.throws(() => statSync(knownHosts), { code: "ENOENT" });
});

test("a caller cannot smuggle extra known_hosts lines through the fingerprint", async (t) => {
  const { keyscan, knownHosts } = sandbox(t);
  const evil = `${ED25519_FINGERPRINT}\nevil.example ssh-ed25519 AAAA`;
  await assert.rejects(
    acceptHostKey({ host: "prod-vps" }, evil, { keyscanBinary: keyscan, knownHostsPath: knownHosts }),
    (error) => error.code === "FINGERPRINT_MISMATCH",
  );
  assert.throws(() => statSync(knownHosts), { code: "ENOENT" });
});

test("an unreachable server cannot be scanned", async (t) => {
  const { keyscan } = sandbox(t, { default: { unreachable: true } });
  await assert.rejects(
    scanHostKey({ host: "gone" }, { keyscanBinary: keyscan }),
    (error) => error.code === "SCAN_FAILED",
  );
});

test("an existing known_hosts directory keeps its contents when a new host is added", async (t) => {
  const { keyscan, knownHosts } = sandbox(t);
  mkdirSync(path.dirname(knownHosts), { recursive: true });
  writeFileSync(knownHosts, "old-host ssh-ed25519 AAAAold\n");
  await acceptHostKey({ host: "prod-vps" }, ED25519_FINGERPRINT, {
    keyscanBinary: keyscan,
    knownHostsPath: knownHosts,
  });
  assert.equal(
    readFileSync(knownHosts, "utf8"),
    `old-host ssh-ed25519 AAAAold\nprod-vps ssh-ed25519 ${ED25519_BLOB}\n`,
  );
  chmodSync(knownHosts, 0o600);
});
