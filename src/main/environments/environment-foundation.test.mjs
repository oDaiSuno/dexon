import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { createDeferred } from "#test-timing";
import { EnvironmentSupervisor } from "./environment-supervisor.ts";
import { startDaemonServer } from "../../agent-host/daemon-server.ts";
import { buildEnvironmentDescriptor } from "../../agent-host/environment-identity.ts";
import { createRpcServer } from "../../contract/rpc.ts";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { parseSshConfigHosts, parseSshConfig, parseSshG } from "./ssh-config-parse.ts";
import { buildRemoteProbeScript, parseRemoteProbe, runtimeDiagnosis } from "./remote-probe.ts";
import { diagnoseSshFailure } from "./ssh-diagnostics.ts";
import * as editing from "./environment-editing.ts";
import { planRuntimeUpgrade } from "./remote-provisioner.ts";
import { initialSupervisorState, reduceSupervisor } from "./supervisor-policy.ts";
import { closeModeFor, removeWithChoice } from "./environment-lifecycle.ts";
import { EnvironmentStore, parseAddEnvironmentInput } from "./environment-store.ts";
import { sshArguments } from "./ssh-command.ts";
import { buildRemoteLaunchScript } from "./ssh-scripts.ts";
const { planEnvironmentUpdate } = editing;
const target = { kind: "ssh", sshAlias: "gpu" };
const savedSsh = (patch = {}) => ({
  id: "saved",
  label: "GPU",
  enabled: true,
  authToken: "secret",
  target: { ...target, expectedEnvironmentId: "bound" },
  ...patch,
});
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
    activeAutomation: null,
    protocolVersion: null,
  },
  ...patch,
});

async function supervised(t) {
  const rpcServer = createRpcServer();
  rpcServer.handle({ "host.ping": async () => ({ ok: true, ts: 42 }) });
  const getDescriptor = () =>
    buildEnvironmentDescriptor({
      environmentId: "bound",
      label: "GPU",
      piVersion: "1.0.0",
      capabilities: {
        browser: false,
        nativeDialogs: false,
        revealInFileManager: false,
        managedProcesses: true,
        toolchainInstall: true,
      },
    });
  const authToken = "a".repeat(64);
  const daemon = await startDaemonServer({ rpcServer, getDescriptor, authToken, listenPort: 0 });
  const endpoint = {
    httpBaseUrl: `http://127.0.0.1:${daemon.port}`,
    wsUrl: `ws://127.0.0.1:${daemon.port}/rpc`,
    authToken,
  };
  const runtime = { ...getDescriptor().runtime, ownership: "managed", updatePending: true };
  const configuration = { target: { ...target, stopOnDisconnect: true } };
  const modes = [];
  const ssh = {
    ensureTunnel: async () => ({ ...endpoint, runtime: { ...runtime } }),
    probe: async () => fixtureProbe(),
    closeTunnel: async (_target, mode) => {
      modes.push(mode);
    },
    stopRemoteDaemon: () => assert.fail("Supervisor must not stop a daemon directly"),
  };
  const supervisor = new EnvironmentSupervisor({
    configuration,
    sshTunnelManager: ssh,
    idleUpgradeIntervalMs: 5,
    onBound() {},
    onChange() {},
  });
  t.after(async () => {
    await supervisor.dispose();
    await daemon.close();
  });
  return { supervisor, endpoint, runtime, configuration, ssh, modes };
}
async function eventually(predicate) {
  for (let attempt = 0; attempt < 400 && !predicate(); attempt++) await delay(5);
  assert.ok(predicate(), "Expected public supervisor state did not arrive");
}

test("Supervisor exposes only cloned connected endpoints and disconnects using the live SSH preference", async (t) => {
  const { supervisor, endpoint, configuration, modes } = await supervised(t);
  assert.equal(supervisor.getEndpoint(), null);
  await supervisor.connect();
  assert.deepEqual(supervisor.getEndpoint(), endpoint);
  supervisor.getEndpoint().authToken = "changed";
  assert.deepEqual(supervisor.getEndpoint(), endpoint);
  const { state, descriptor, runtime } = supervisor;
  assert.ok(!JSON.stringify([state, descriptor, runtime]).includes(endpoint.authToken));
  await supervisor.disconnect();
  assert.equal(supervisor.getEndpoint(), null);
  assert.equal(modes.at(-1), "stop-managed");
  configuration.target.stopOnDisconnect = false;
  await supervisor.disconnect();
  assert.equal(modes.at(-1), "disconnect");
});

test("idle upgrades never overlap probes and refresh only confirmed idle managed running SSH daemons", async (t) => {
  const { supervisor, runtime, ssh, modes } = await supervised(t);
  let pending = createDeferred();
  let probes = 0;
  ssh.probe = async () => {
    probes++;
    return pending.promise;
  };
  await supervisor.connect();
  await eventually(() => probes === 1);
  await delay(25);
  assert.equal(probes, 1);
  const idle = { running: true, ownership: "managed", activeSessions: 0, activeAutomation: 0 };
  for (const patch of [
    { activeSessions: 1 },
    { activeAutomation: 1 },
    { activeSessions: null },
    { activeAutomation: null },
    { running: false },
    { ownership: "external" },
    new Error("Probe unavailable"),
  ]) {
    const before = probes;
    if (patch instanceof Error) pending.reject(patch);
    else pending.resolve(fixtureProbe({ daemon: { ...idle, ...patch } }));
    pending = createDeferred();
    await eventually(() => probes > before);
    assert.equal(supervisor.state.generation, 1);
  }
  runtime.updatePending = false;
  pending.resolve(fixtureProbe({ daemon: idle }));
  await eventually(() => supervisor.state.generation === 2 && supervisor.getEndpoint() !== null);
  assert.deepEqual(modes, ["disconnect"]);
  const completed = probes;
  await delay(25);
  assert.equal(probes, completed);
});

test("cancelled idle probes cannot reconnect after disconnect, disposal or replacement generations", async (t) => {
  for (const action of ["disconnect", "reconnect", "dispose"]) {
    const { supervisor, runtime, ssh } = await supervised(t);
    const pending = createDeferred();
    let signal;
    ssh.probe = async (_target, cancellation) => {
      signal = cancellation;
      return pending.promise;
    };
    await supervisor.connect();
    await eventually(() => signal !== undefined);
    if (action === "dispose") await supervisor.dispose();
    else await supervisor.disconnect("disconnect");
    assert.equal(signal.aborted, true);
    if (action === "reconnect") {
      runtime.updatePending = false;
      await supervisor.connect();
    }
    const generation = supervisor.state.generation;
    pending.resolve(
      fixtureProbe({ daemon: { running: true, ownership: "managed", activeSessions: 0, activeAutomation: 0 } }),
    );
    await delay(25);
    assert.equal(supervisor.state.generation, generation);
    assert.equal(supervisor.getEndpoint() !== null, action === "reconnect");
  }
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

test("the remote launcher starts its daemon with sixteen file-system worker threads unless the server chose its own", (t) => {
  if (process.platform === "win32") return t.skip("The remote shell runs on POSIX hosts");
  const directory = mkdtempSync(path.join(tmpdir(), "dexon-remote-threads-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const daemon = path.join(directory, "daemon.mjs");
  const report = path.join(directory, "threads.txt");
  writeFileSync(
    daemon,
    `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(report)}, process.env.UV_THREADPOOL_SIZE ?? "unset");\n`,
  );
  const launchWith = (threads) => {
    rmSync(report, { force: true });
    const env = { ...process.env, HOME: directory };
    if (threads === undefined) delete env.UV_THREADPOOL_SIZE;
    else env.UV_THREADPOOL_SIZE = threads;
    const script = buildRemoteLaunchScript({
      stateKey: "0123456789abcdef",
      preferredPort: 40_000 + Math.floor(Math.random() * 10_000),
      remoteStateDir: path.join(directory, "state"),
      daemonScriptPath: daemon,
      nodePath: process.execPath,
    });
    const launched = spawnSync("sh", ["-c", script], { env, encoding: "utf8", timeout: 20_000 });
    assert.match(launched.stderr, /Remote daemon exited during startup/, "the stand-in daemon exits after reporting");
    return readFileSync(report, "utf8");
  };
  assert.equal(launchWith(undefined), "16");
  assert.equal(launchWith("24"), "24", "an operator's explicit thread count is kept");
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
  const current = savedSsh();
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

test("toggling only the SSH disconnect preference retains identity and credentials without rebinding or reconnecting", () => {
  for (const previous of [undefined, false, true]) {
    const current = savedSsh({ enabled: false });
    current.target.stopOnDisconnect = previous;
    for (const stopOnDisconnect of [undefined, false, true]) {
      const plan = planEnvironmentUpdate(current, {
        label: "GPU",
        target: { ...target, stopOnDisconnect },
      });
      assert.equal(plan.configuration.target.stopOnDisconnect, stopOnDisconnect);
      assert.equal(plan.configuration.target.expectedEnvironmentId, "bound");
      assert.equal(plan.configuration.authToken, "secret");
      assert.equal(plan.configuration.id, "saved");
      assert.equal(plan.configuration.enabled, false);
      assert.equal(plan.rebind, false);
      assert.equal(plan.reconnect, false);
      assert.equal(current.target.stopOnDisconnect, previous);
    }
  }
});

test("shared editing boundaries reject duplicate targets and identities and roll back failed binding saves", () => {
  const current = { id: "saved", label: "GPU", enabled: true, target: { ...target } };
  const existing = { ...current, id: "other", target: { ...target, expectedEnvironmentId: "bound" } };
  assert.throws(() => editing.assertUniqueEnvironmentTarget(current, [existing]), /already exists/);
  assert.doesNotThrow(() => editing.assertUniqueEnvironmentTarget(current, [current], current.id));
  const relocated = { ...existing, target: { ...target, remotePort: 4000 } };
  assert.doesNotThrow(() => editing.assertUniqueEnvironmentTarget(current, [relocated]));
  const bind = (configurations, persist = () => {}) =>
    editing.bindEnvironmentIdentity(current, { environmentId: "bound" }, configurations, persist);
  assert.throws(() => bind([existing]), { kind: "blocked", reason: "configuration" });
  const saveFailure = () => {
    throw new Error("disk full");
  };
  assert.throws(() => bind([], saveFailure), /disk full/);
  assert.equal(current.target.expectedEnvironmentId, undefined);
  bind([], () => assert.equal(current.target.expectedEnvironmentId, "bound"));
  bind([current], () => assert.fail("Already saved"));
});

test("old managed daemons upgrade only after confirmed zero sessions and automation", () => {
  const daemon = { running: true, ownership: "managed", payloadVersion: "old", activeSessions: 0, activeAutomation: 0 };
  const upgraded = planRuntimeUpgrade(fixtureProbe({ daemon }), "new");
  assert.deepEqual(upgraded, { deploy: true, restartDaemon: true, updatePending: false });
  const pending = { deploy: false, restartDaemon: false, updatePending: true };
  for (const activeAutomation of [1, 3, null])
    assert.deepEqual(planRuntimeUpgrade(fixtureProbe({ daemon: { ...daemon, activeAutomation } }), "new"), pending);
  for (const activeSessions of [1, null])
    assert.deepEqual(planRuntimeUpgrade(fixtureProbe({ daemon: { ...daemon, activeSessions } }), "new"), pending);
  assert.equal(
    planRuntimeUpgrade(fixtureProbe({ daemon: { ...daemon, ownership: "external" } }), "new").restartDaemon,
    false,
  );
});

test("disabling automatic reconnect leaves failed connections offline and preserves the reason", () => {
  const state = reduceSupervisor(initialSupervisorState(), { type: "start" });
  const failure = { type: "failure", error: new Error("network unavailable"), now: 1000, random: 0 };
  const failed = reduceSupervisor(state, failure, { detachedDaemon: true, autoReconnect: false });
  const lastFailure = { reason: "network", detail: "network unavailable" };
  assert.deepEqual(failed.status, { phase: "offline", lastFailure });
  const retry = reduceSupervisor(state, failure);
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

test("removing an unreachable remote daemon still removes its saved configuration", async () => {
  let removed = false;
  const outcome = await removeWithChoice("stop", {
    stopManaged: () => Promise.reject(new Error("offline")),
    disconnect: async () => {},
    remove: () => {
      removed = true;
    },
  });
  assert.deepEqual(outcome, { remoteDaemon: "unreachable" });
  assert.equal(removed, true);
});

test("SSH disconnect preferences override global policy except when reconfiguring a connection", () => {
  for (const [detachedDaemon, fallback] of [
    [true, "disconnect"],
    [false, "stop-managed"],
  ]) {
    const policy = { detachedDaemon, autoReconnect: true };
    const cases = [
      [{ ...target, stopOnDisconnect: true }, "stop-managed"],
      [{ ...target, stopOnDisconnect: false }, "disconnect"],
      [target, fallback],
      [undefined, fallback],
      [{ kind: "primary" }, fallback],
      [{ kind: "websocket", url: "ws://127.0.0.1:4100/rpc" }, fallback],
    ];
    for (const [configuration, expected] of cases) {
      assert.equal(closeModeFor("disconnect", policy, configuration), expected);
      assert.equal(closeModeFor("shutdown", policy, configuration), expected);
      assert.equal(closeModeFor("reconfigure", policy, configuration), "disconnect");
    }
  }
});

test("version-one environment files preserve lifecycle policy and optional SSH preferences across reloads", (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "dexon-env-store-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(path.join(directory, "environments.json"), JSON.stringify({ version: 1, environments: [] }));
  const store = new EnvironmentStore(directory);
  assert.deepEqual(store.load(), []);
  assert.deepEqual(store.policy, { detachedDaemon: true, autoReconnect: true });
  const environments = [undefined, false, true].map((stopOnDisconnect) =>
    store.create({ label: "GPU", target: { ...target, stopOnDisconnect } }),
  );
  environments.push(
    store.create({ label: "WebSocket", target: { kind: "websocket", url: "ws://127.0.0.1:4100/rpc" } }),
  );
  store.save(environments, { detachedDaemon: false, autoReconnect: false });
  const saved = JSON.parse(readFileSync(path.join(directory, "environments.json"), "utf8"));
  assert.equal(saved.version, 1);
  assert.deepEqual(
    saved.environments.map((entry) => entry.target.stopOnDisconnect),
    [undefined, false, true, undefined],
  );
  assert.equal(Object.hasOwn(saved.environments[0].target, "stopOnDisconnect"), false);
  assert.equal(Object.hasOwn(saved.environments[3].target, "stopOnDisconnect"), false);
  const reloaded = new EnvironmentStore(directory);
  assert.deepEqual(reloaded.load(), environments);
  assert.deepEqual(reloaded.policy, { detachedDaemon: false, autoReconnect: false });
});

test("stop-on-disconnect accepts only SSH booleans at the input and persisted-file boundaries", (t) => {
  for (const stopOnDisconnect of [null, 0, 1, "true", {}, []])
    assert.throws(() => parseAddEnvironmentInput({ label: "GPU", target: { ...target, stopOnDisconnect } }));
  const websocket = { kind: "websocket", url: "ws://127.0.0.1:4100/rpc" };
  for (const stopOnDisconnect of [true, false, null, "true"])
    assert.throws(() => parseAddEnvironmentInput({ label: "WebSocket", target: { ...websocket, stopOnDisconnect } }));
  const directory = mkdtempSync(path.join(tmpdir(), "dexon-env-invalid-stop-policy-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new EnvironmentStore(directory);
  const environment = store.create({ label: "GPU", target });
  environment.target.stopOnDisconnect = "false";
  const persisted = { version: 1, environments: [environment] };
  writeFileSync(path.join(directory, "environments.json"), JSON.stringify(persisted));
  assert.throws(() => store.load());
});

test("a newer remote payload is reused instead of being downgraded by an older desktop", () => {
  const probe = fixtureProbe({
    daemon: { running: true, ownership: "managed", payloadVersion: "0.4.0-new", activeSessions: 0 },
  });
  const reused = planRuntimeUpgrade(probe, "0.3.3-old");
  assert.deepEqual(reused, { deploy: false, restartDaemon: false, updatePending: false });
});

test("missing POSIX tools and local SSH spawn failures retain actionable diagnoses", () => {
  const { diagnosis } = diagnoseSshFailure("unsupported: tar executable is unavailable", target);
  assert.equal(diagnosis.reason, "unsupported");
  for (const code of ["ENOENT", "ENOTDIR", "EACCES"]) {
    const result = diagnoseSshFailure(`spawn ssh ${code} token=private`, target, code);
    assert.equal(result.kind, "blocked", code);
    assert.ok(result.diagnosis.detail.includes(code));
    assert.ok(!result.diagnosis.detail.includes("private"));
  }
});

test("changing a WebSocket environment URL clears the saved auth token unless a new one is supplied", () => {
  const current = {
    id: "env-ws",
    label: "Remote A",
    target: { kind: "websocket", url: "ws://127.0.0.1:4100/rpc", expectedEnvironmentId: "remote-a" },
    authToken: "saved-token",
    enabled: true,
  };
  for (const [url, authToken, rebind, expectedToken] of [
    ["ws://127.0.0.1:4100/rpc", undefined, false, "saved-token"],
    ["ws://127.0.0.1:4999/rpc", undefined, true, undefined],
    ["ws://127.0.0.1:4999/rpc", "explicit-new-token", true, "explicit-new-token"],
  ]) {
    const plan = planEnvironmentUpdate(current, { label: "Renamed", target: { kind: "websocket", url }, authToken });
    assert.equal(plan.rebind, rebind);
    assert.equal(plan.configuration.authToken, expectedToken);
  }
});
