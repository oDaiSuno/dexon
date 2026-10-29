import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ManagedProcessReaper } from "./reaper.ts";
import { canRestartHostAfterCleanup } from "./restart-gate.ts";

const NONCE = "a".repeat(64);

function windowsRecord() {
  return {
    version: 2,
    platform: "win32",
    processId: "proc-a",
    runId: "run-a",
    hostInstanceId: "host-a",
    nonce: NONCE,
    createdAt: 1,
    helperPid: 4242,
    helperStartFingerprint: "helper-fingerprint",
    helperBuildId: "pimpd-0.1.13-p1-abcdef123456",
    jobName: `Local\\PiDesktop.Managed.${NONCE}`,
  };
}

async function journalPath(prefix) {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  return path.join(directory, "journal-v2.json");
}

async function gate(options, journal) {
  const reaper = new ManagedProcessReaper(journal, options);
  await reaper.initialize();
  const status = await reaper.reapAll();
  return { status, allowed: canRestartHostAfterCleanup(status) };
}

test("Windows without the cleanup helper and with no leftover records allows the Host to restart", async () => {
  const { status, allowed } = await gate({ platform: "win32" }, await journalPath("pi-restart-gate-"));
  assert.deepEqual(
    { ready: status.ready, records: status.records, errorCode: status.errorCode },
    { ready: false, records: 0, errorCode: "CONTAINMENT_UNAVAILABLE" },
  );
  assert.equal(allowed, true);
});

test("Windows without the cleanup helper still blocks a restart while a leftover process record exists", async () => {
  const journal = await journalPath("pi-restart-gate-leftover-");
  await writeFile(journal, JSON.stringify({ version: 2, revision: 1, records: [windowsRecord()] }));
  const { status, allowed } = await gate({ platform: "win32" }, journal);
  assert.equal(status.records, 1);
  assert.equal(status.errorCode, "CONTAINMENT_UNAVAILABLE");
  assert.equal(allowed, false);
});

test("A damaged cleanup journal blocks a restart", async () => {
  const journal = await journalPath("pi-restart-gate-damaged-");
  await writeFile(journal, "not json");
  const { allowed } = await gate({ platform: "win32" }, journal);
  assert.equal(allowed, false);
});

test("a real cleanup failure blocks a restart even when no record is left", () => {
  assert.equal(canRestartHostAfterCleanup({ ready: false, revision: 3, records: 0, errorCode: "REAP_FAILED" }), false);
  assert.equal(
    canRestartHostAfterCleanup({ ready: false, revision: 3, records: 0, errorCode: "IDENTITY_UNCERTAIN" }),
    false,
  );
});

test("A healthy reaper with no leftover records allows the Host to restart", async () => {
  const { status, allowed } = await gate(
    { platform: "darwin", groupExists: () => false },
    await journalPath("pi-restart-gate-healthy-"),
  );
  assert.equal(status.records, 0);
  assert.equal(allowed, true);
});
