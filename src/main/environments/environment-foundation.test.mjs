import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseSshConfigHosts, parseSshConfig, parseSshG } from "./ssh-config-parse.ts";
import { buildRemoteProbeScript, parseRemoteProbe, runtimeDiagnosis } from "./remote-probe.ts";
import { diagnoseSshFailure } from "./ssh-diagnostics.ts";
import { planEnvironmentUpdate } from "./environment-editing.ts";
import { planRuntimeUpgrade } from "./remote-provisioner.ts";
import { initialSupervisorState, reduceSupervisor } from "./supervisor-policy.ts";
import { closeModeFor, removeWithChoice } from "./environment-lifecycle.ts";
import { EnvironmentStore } from "./environment-store.ts";
import { sshArguments } from "./ssh-command.ts";
const target = { kind: "ssh", sshAlias: "gpu" };
const fixtureProbe = (patch = {}) => ({
  home: "/home/dev",
  user: "dev",
  stateDir: "/home/dev/.dexon",
  writable: true,
  os: "linux",
  arch: "x64",
  nodes: [{ path: "/usr/bin/node", version: "22.23.3" }],
  node: { path: "/usr/bin/node", version: "22.23.3" },
  installed: false,
  daemon: {
    running: false,
    ownership: null,
    payloadVersion: null,
    since: null,
    activeSessions: null,
    protocolVersion: null,
  },
  ...patch,
});

test("SSH discovery lists concrete quoted aliases and leaves wildcard inheritance to OpenSSH", () => {
  const text =
    'Host gpu "build-box" !excluded *.example\n HostName ignored\nInclude "hosts/team config" hosts/*.conf\nHOST=gpu local # trailing comment\n';
  assert.deepEqual(parseSshConfigHosts(text), ["gpu", "build-box", "local"]);
  assert.deepEqual(parseSshConfig(text).includes, ["hosts/team config", "hosts/*.conf"]);
  assert.deepEqual(
    parseSshG(
      "hostname 10.0.0.1\nuser ubuntu\nport 2202\nproxyjump jump\nidentityfile ~/.ssh/id_ed25519\nidentityfile ignored\n",
    ),
    { hostname: "10.0.0.1", user: "ubuntu", port: 2202, proxyJump: "jump", identityFile: "~/.ssh/id_ed25519" },
  );
});

test("runtime selection ignores login noise and chooses the newest supported absolute Node executable", () => {
  const text = [
    "Welcome!",
    "DEXON\tHOME\t/home/dev",
    "DEXON\tUSER\tdev",
    "DEXON\tSTATE\t/data/dexon",
    "DEXON\tWRITABLE\t1",
    "DEXON\tOS\tlinux",
    "DEXON\tARCH\tarm64",
    "DEXON\tINSTALLED\t0",
    "DEXON\tNODE\t/usr/bin/node\t23.1.0",
    "DEXON\tNODE\t/home/dev/.nvm/node\t22.23.3",
    "DEXON\tNODE\t/opt/node\t22.19.0",
    "DEXON\tNODE\tnode\t22.24.0",
  ].join("\n");
  const probe = parseRemoteProbe(text);
  assert.deepEqual(probe.node, { path: "/home/dev/.nvm/node", version: "22.23.3" });
  assert.equal(runtimeDiagnosis(probe), null);
  assert.equal(runtimeDiagnosis(fixtureProbe({ node: null, nodes: [] })).reason, "missing-node");
  assert.equal(runtimeDiagnosis(fixtureProbe({ node: null })).reason, "unsupported-node-version");
  assert.deepEqual(runtimeDiagnosis(fixtureProbe({ writable: false })), {
    reason: "permission",
    detail: "Remote state directory is not writable: /home/dev/.dexon",
    path: "/home/dev/.dexon",
    suggestedStateDir: "/tmp/dexon-dev",
  });
  assert.equal(runtimeDiagnosis(fixtureProbe({ os: "win32" })).reason, "unsupported");
  assert.throws(() => parseRemoteProbe("Welcome!"), /Incomplete/);
});

test("the real shell probe resolves a quoted custom state directory without installing or starting anything", (t) => {
  if (process.platform === "win32") return t.skip("The remote shell runs on POSIX hosts");
  const directory = mkdtempSync(path.join(tmpdir(), "dexon-probe-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const remoteStateDir = path.join(directory, "state's directory");
  const output = execFileSync("sh", ["-c", buildRemoteProbeScript({ ...target, remoteStateDir }, "0.3.3")], {
    encoding: "utf8",
    timeout: 20000,
    env: { ...process.env, SHELL: "/bin/sh" },
  });
  const probe = parseRemoteProbe(output);
  assert.equal(probe.stateDir, remoteStateDir);
  assert.equal(probe.writable, true);
  assert.ok(probe.node?.path.startsWith("/"));
  assert.equal(probe.daemon.running, false);
});

test("SSH authentication, changed host keys, permissions and missing executables have distinct actionable diagnoses", () => {
  const auth = diagnoseSshFailure("Permission denied (publickey).", { ...target, user: "ubuntu", port: 2202 });
  assert.equal(auth.diagnosis.reason, "authentication");
  assert.equal(auth.diagnosis.copyIdCommand, "ssh-copy-id -p 2202 ubuntu@gpu");
  const changed = diagnoseSshFailure(
    "REMOTE HOST IDENTIFICATION HAS CHANGED\nHost key for gpu has changed\nSHA256:abc123\nOffending ED25519 key in /home/me/.ssh/known_hosts:12",
    target,
  );
  assert.equal(changed.diagnosis.reason, "host-key-changed");
  assert.equal(changed.diagnosis.fingerprint, "SHA256:abc123");
  assert.equal(changed.diagnosis.knownHostsFile, "/home/me/.ssh/known_hosts");
  assert.equal(diagnoseSshFailure("EACCES: permission denied", target).diagnosis.reason, "permission");
  assert.equal(diagnoseSshFailure("missing ssh", target, "ENOENT").diagnosis.reason, "ssh-unavailable");
  assert.equal(diagnoseSshFailure("Connection timed out", target).failure.reason, "timeout");
  assert.ok(sshArguments(target).includes("StrictHostKeyChecking=accept-new"));
});

test("renaming a server retains its identity while changing its state directory requires a new binding", () => {
  const current = {
    id: "saved",
    label: "GPU",
    enabled: true,
    target: { ...target, expectedEnvironmentId: "bound" },
    authToken: "secret",
  };
  const rename = planEnvironmentUpdate(current, { label: "Training", target });
  assert.equal(rename.reconnect, false);
  assert.equal(rename.configuration.target.expectedEnvironmentId, "bound");
  assert.equal(rename.configuration.authToken, "secret");
  const relocate = planEnvironmentUpdate(current, {
    label: "Training",
    target: { ...target, remoteStateDir: "/tmp/dexon" },
  });
  assert.equal(relocate.rebind, true);
  assert.equal(relocate.reconnect, true);
  assert.equal(relocate.configuration.target.expectedEnvironmentId, undefined);
});

test("old managed daemons upgrade only after a confirmed zero-session report", () => {
  const daemon = { running: true, ownership: "managed", payloadVersion: "old", activeSessions: 0 };
  assert.deepEqual(planRuntimeUpgrade(fixtureProbe({ daemon }), "new"), {
    deploy: true,
    restartDaemon: true,
    updatePending: false,
  });
  for (const activeSessions of [1, null])
    assert.deepEqual(planRuntimeUpgrade(fixtureProbe({ daemon: { ...daemon, activeSessions } }), "new"), {
      deploy: false,
      restartDaemon: false,
      updatePending: true,
    });
  assert.equal(
    planRuntimeUpgrade(fixtureProbe({ daemon: { ...daemon, ownership: "external" } }), "new").restartDaemon,
    false,
  );
});

test("disabling automatic reconnect leaves failed connections offline and preserves the reason", () => {
  const state = reduceSupervisor(initialSupervisorState(), { type: "start" });
  const failed = reduceSupervisor(
    state,
    { type: "failure", error: new Error("network unavailable"), now: 1000, random: 0 },
    { detachedDaemon: true, autoReconnect: false },
  );
  assert.deepEqual(failed.status, {
    phase: "offline",
    lastFailure: { reason: "network", detail: "network unavailable" },
  });
  const retry = reduceSupervisor(state, {
    type: "failure",
    error: new Error("network unavailable"),
    now: 1000,
    random: 0,
  });
  assert.equal(retry.status.retryAt, 2000);
  assert.equal(
    reduceSupervisor(retry, { type: "policy-changed" }, { detachedDaemon: true, autoReconnect: false }).status.phase,
    "offline",
  );
  assert.equal(
    reduceSupervisor(state, { type: "failure", error: new Error("EACCES"), now: 0 }).status.diagnosis.reason,
    "permission",
  );
});

test("lifecycle policy controls disconnect and shutdown without stopping a daemon during edits", async () => {
  const policy = { detachedDaemon: false, autoReconnect: true };
  assert.equal(closeModeFor("disconnect", policy), "stop-managed");
  assert.equal(closeModeFor("shutdown", policy), "stop-managed");
  assert.equal(closeModeFor("reconfigure", policy), "disconnect");
  let removed = false;
  const outcome = await removeWithChoice("stop", {
    stopManaged: async () => {
      throw new Error("offline");
    },
    disconnect: async () => {},
    remove: () => {
      removed = true;
    },
  });
  assert.deepEqual(outcome, { remoteDaemon: "unreachable" });
  assert.equal(removed, true);
});

test("environment files keep version one and retain additive policy across reloads", (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "dexon-env-store-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, "environments.json"), JSON.stringify({ version: 1, environments: [] }));
  const store = new EnvironmentStore(directory);
  assert.deepEqual(store.load(), []);
  assert.deepEqual(store.policy, { detachedDaemon: true, autoReconnect: true });
  store.save([], { detachedDaemon: false, autoReconnect: false });
  const reloaded = new EnvironmentStore(directory);
  reloaded.load();
  assert.deepEqual(reloaded.policy, { detachedDaemon: false, autoReconnect: false });
  assert.equal(JSON.parse(readFileSync(path.join(directory, "environments.json"), "utf8")).version, 1);
});

test("a newer remote payload is reused instead of being downgraded by an older desktop", () => {
  const probe = fixtureProbe({
    daemon: { running: true, ownership: "managed", payloadVersion: "0.4.0-new", activeSessions: 0 },
  });
  assert.deepEqual(planRuntimeUpgrade(probe, "0.3.3-old"), {
    deploy: false,
    restartDaemon: false,
    updatePending: false,
  });
});

test("missing POSIX runtime tools block with an unsupported diagnosis rather than retrying forever", () => {
  assert.equal(
    diagnoseSshFailure("unsupported: tar executable is unavailable", target).diagnosis.reason,
    "unsupported",
  );
});

test("local SSH OS spawn failures are blocked and preserve their original diagnostic", () => {
  for (const code of ["ENOENT", "ENOTDIR", "EACCES"]) {
    const result = diagnoseSshFailure(`spawn ssh ${code} token=private`, target, code);
    assert.equal(result.kind, "blocked", code);
    assert.ok(result.diagnosis.detail.includes(code));
    assert.ok(!result.diagnosis.detail.includes("private"));
  }
});
