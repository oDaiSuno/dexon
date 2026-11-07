import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

const { describeBlocked } = await importTestBundle("blocked-diagnosis-view", {
  entryPoints: [path.join(import.meta.dirname, "blocked-diagnosis-view.ts")],
});

const target = Object.freeze({
  id: "gpu-server",
  label: "Training server",
  enabled: true,
  target: Object.freeze({ kind: "ssh", sshAlias: "gpu-train" }),
  status: Object.freeze({ phase: "offline", lastFailure: null }),
  descriptor: null,
});

function describe(diagnosis) {
  const before = structuredClone(diagnosis);
  const view = describeBlocked(Object.freeze(diagnosis), target);
  assert.equal(view.reason, diagnosis.reason);
  assert.equal(view.detail, diagnosis.detail);
  assert.equal(view.targetLabel, "Training server");
  assert.deepEqual(diagnosis, before);
  return view;
}

test("authentication copies only the supplied command and never invents one when it is absent", () => {
  const copyIdCommand = "ssh-copy-id -p 2222 alex@gpu.example";
  for (const command of [copyIdCommand, null]) {
    const diagnosis = {
      reason: "authentication",
      detail: "Public key authentication was rejected",
      copyIdCommand: command,
    };
    assert.deepEqual(describe(diagnosis), {
      reason: "authentication",
      title: "Passwordless login required",
      detail: "Public key authentication was rejected",
      targetLabel: "Training server",
      fields: [],
      action: command === null ? null : { kind: "copy", text: copyIdCommand, purpose: "authentication" },
    });
  }
});

const required = Object.freeze({ range: ">=22.19.0 <23", minimum: "22.19.0", major: 22 });

test("a missing runtime exposes its exact required range and supplied upgrade command", () => {
  const diagnosis = {
    reason: "missing-node",
    detail: "No Node.js executable was found",
    required,
    upgradeCommand: "fnm install 22.23.3 && fnm default 22.23.3",
  };
  assert.deepEqual(describe(diagnosis), {
    reason: "missing-node",
    title: "Node.js is not installed",
    detail: "No Node.js executable was found",
    targetLabel: "Training server",
    fields: [{ kind: "required-version", value: ">=22.19.0 <23" }],
    action: { kind: "copy", text: "fnm install 22.23.3 && fnm default 22.23.3", purpose: "node-upgrade" },
  });
});

test("an incompatible runtime keeps the detected version separate from the required range", () => {
  const diagnosis = {
    reason: "unsupported-node-version",
    detail: "The detected Node.js version is outside the supported range",
    detectedVersion: "v24.1.0",
    required,
    upgradeCommand: "nvm install 22 && nvm alias default 22",
  };
  assert.deepEqual(describe(diagnosis), {
    reason: "unsupported-node-version",
    title: "Node.js version is not supported",
    detail: "The detected Node.js version is outside the supported range",
    targetLabel: "Training server",
    fields: [
      { kind: "detected-version", value: "v24.1.0" },
      { kind: "required-version", value: ">=22.19.0 <23" },
    ],
    action: { kind: "copy", text: "nvm install 22 && nvm alias default 22", purpose: "node-upgrade" },
  });
});

test("SSH host-key changes preserve the host, fingerprint and file and request only host-key trust", () => {
  const diagnosis = {
    reason: "host-key-changed",
    detail: "The host key differs from the recorded key",
    knownHost: "[2001:db8::5]:2222",
    fingerprint: "SHA256:changed-key",
    knownHostsFile: "/home/alex/.ssh/custom_known_hosts",
    mismatchLayer: "ssh-known-hosts",
  };
  assert.deepEqual(describe(diagnosis), {
    reason: "host-key-changed",
    title: "SSH host key changed",
    detail: "The host key differs from the recorded key",
    targetLabel: "Training server",
    fields: [
      { kind: "known-host", value: "[2001:db8::5]:2222" },
      { kind: "fingerprint", value: "SHA256:changed-key" },
      { kind: "known-hosts-file", value: "/home/alex/.ssh/custom_known_hosts" },
    ],
    action: { kind: "trust", trust: "host-key", fingerprint: "SHA256:changed-key" },
  });
  const unknownFingerprint = describe({
    reason: "host-key-changed",
    detail: "The fingerprint could not be read",
    knownHost: "gpu-train",
    fingerprint: null,
    mismatchLayer: "ssh-known-hosts",
  });
  assert.deepEqual(unknownFingerprint.fields, [{ kind: "known-host", value: "gpu-train" }]);
  assert.deepEqual(unknownFingerprint.action, { kind: "trust", trust: "host-key", fingerprint: null });
});

test("an environment identity mismatch keeps both IDs and never asks to trust an SSH key", () => {
  const diagnosis = {
    reason: "identity-mismatch",
    detail: "The daemon identifies as a different environment",
    expectedEnvironmentId: "training-cluster-original",
    actualEnvironmentId: "training-cluster-rebuilt",
    mismatchLayer: "dexon-environment-id",
  };
  assert.deepEqual(describe(diagnosis), {
    reason: "identity-mismatch",
    title: "Server identity changed",
    detail: "The daemon identifies as a different environment",
    targetLabel: "Training server",
    fields: [
      { kind: "expected-id", value: "training-cluster-original" },
      { kind: "actual-id", value: "training-cluster-rebuilt" },
    ],
    action: { kind: "trust", trust: "environment-identity", fingerprint: null },
  });
});

test("directory permission failures retain the failed path and suggest editing the supplied state directory", () => {
  const diagnosis = {
    reason: "permission",
    detail: "The remote state directory is read-only",
    path: "/shared/readonly/.dexon",
    suggestedStateDir: "/scratch/alex/dexon data",
  };
  assert.deepEqual(describe(diagnosis), {
    reason: "permission",
    title: "Remote directory is not writable",
    detail: "The remote state directory is read-only",
    targetLabel: "Training server",
    fields: [{ kind: "path", value: "/shared/readonly/.dexon" }],
    action: { kind: "edit-field", field: "remoteStateDir", suggestedValue: "/scratch/alex/dexon data" },
  });
});

test("an outdated daemon displays its reported protocol without inventing an upgrade command", () => {
  const diagnosis = { reason: "outdated-daemon", detail: "The daemon protocol is too old", remoteProtocolVersion: 0 };
  assert.deepEqual(describe(diagnosis), {
    reason: "outdated-daemon",
    title: "Remote service needs an update",
    detail: "The daemon protocol is too old",
    targetLabel: "Training server",
    fields: [{ kind: "protocol", value: "0" }],
    action: null,
  });
});

for (const [reason, title, detail] of [
  ["ssh-unavailable", "SSH is unavailable", "OpenSSH is not installed on this computer"],
  ["configuration", "Server configuration needs attention", "The server URL is invalid"],
  ["unsupported", "Remote platform is not supported", "No bundled payload supports freebsd-x64"],
  ["unsupported-protocol", "Remote protocol is not supported", "The server uses an unsupported protocol"],
]) {
  test(`${reason} retains the diagnostic detail without inventing fields or recovery commands`, () => {
    assert.deepEqual(describe({ reason, detail }), {
      reason,
      title,
      detail,
      targetLabel: "Training server",
      fields: [],
      action: null,
    });
  });
}
