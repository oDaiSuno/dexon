import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createRpcServer } from "../../contract/rpc.ts";
import { RpcError } from "../../contract/types.ts";
import { startDaemonServer } from "../../agent-host/daemon-server.ts";
import { buildEnvironmentDescriptor } from "../../agent-host/environment-identity.ts";
import { buildRemoteProbeScript, daemonIsIdle, parseRemoteProbe } from "./remote-probe.ts";
import { computeSshStateKey } from "./ssh-scripts.ts";
import { planRuntimeUpgrade } from "./remote-provisioner.ts";
import {
  DAEMON_EXIT_DEADLINE_MS,
  REMOTE_STOP_WAIT_MS,
  REMOTE_STOP_COMMAND_TIMEOUT_MS,
  ENVIRONMENT_SHUTDOWN_BUDGET_MS,
  QUIT_CLEANUP_DEADLINE_MS,
} from "../../shared/shutdown-budget.ts";

const execute = promisify(execFile);
const records = (daemon) =>
  [
    "DEXON\tHOME\t/home/dev",
    "DEXON\tUSER\tdev",
    "DEXON\tSTATE\t/home/dev/.dexon",
    "DEXON\tWRITABLE\t1",
    "DEXON\tOS\tlinux",
    "DEXON\tARCH\tx64",
    "DEXON\tINSTALLED\t1",
    `DEXON\tDAEMON\t${JSON.stringify(daemon)}`,
  ].join("\n");
const idle = {
  running: true,
  ownership: "managed",
  activeSessions: 0,
  activeAutomation: 0,
  payloadVersion: "old",
  since: 1,
  protocolVersion: 1,
};

test("unknown and malformed automation counts fail closed while idle and waiting-only daemons can upgrade", () => {
  for (const count of [0, 1, null]) {
    const daemon = parseRemoteProbe(records({ ...idle, activeAutomation: count })).daemon;
    assert.equal(daemonIsIdle(daemon), count === 0);
    assert.equal(planRuntimeUpgrade({ daemon, installed: false }, "new").updatePending, count !== 0);
  }
  for (const activeAutomation of [-1, 0.5, "0", undefined])
    assert.throws(() => parseRemoteProbe(records({ ...idle, activeAutomation })), /Invalid remote daemon probe/);
  assert.equal(daemonIsIdle({ ...idle, ownership: "external" }), false);
  assert.equal(daemonIsIdle({ ...idle, activeSessions: 1 }), false);
  assert.equal(daemonIsIdle({ ...idle, activeSessions: null }), false);
});

test("shutdown budgets let remote cleanup finish before its callers give up", () => {
  assert.ok(DAEMON_EXIT_DEADLINE_MS < REMOTE_STOP_WAIT_MS);
  assert.ok(REMOTE_STOP_WAIT_MS < REMOTE_STOP_COMMAND_TIMEOUT_MS);
  assert.ok(REMOTE_STOP_COMMAND_TIMEOUT_MS <= ENVIRONMENT_SHUTDOWN_BUDGET_MS);
  assert.ok(ENVIRONMENT_SHUTDOWN_BUDGET_MS < QUIT_CLEANUP_DEADLINE_MS);
});

test("the real embedded probe waits for sessions and automation on one socket and handles legacy, errors and timeouts safely", async (t) => {
  if (process.platform === "win32") return t.skip("Remote probe requires a POSIX shell");
  const directory = await mkdtemp(path.join(tmpdir(), "dexon-activity-probe-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const target = { kind: "ssh", sshAlias: "probe", remoteStateDir: directory };
  const token = "a".repeat(64);
  const descriptor = buildEnvironmentDescriptor({
    environmentId: "probe-id",
    label: "Probe",
    piVersion: "1.4.0",
    capabilities: {
      browser: false,
      nativeDialogs: false,
      revealInFileManager: false,
      managedProcesses: true,
      toolchainInstall: true,
    },
  });
  const server = createRpcServer();
  let activity = { executingRuns: 0, cancellingRuns: 0, activeProbes: 0 };
  let mode = "counts";
  let sessions = 0;
  server.handle({
    "sessions.list": async () => {
      sessions++;
      return { runningSessionIds: [] };
    },
    "automation.activity": async () => {
      if (mode === "legacy") throw new RpcError({ code: "METHOD_NOT_FOUND", message: "Legacy daemon" });
      if (mode === "error") throw new RpcError({ code: "INTERNAL", message: "Unavailable" });
      if (mode === "timeout") return new Promise(() => {});
      return activity;
    },
  });
  const daemon = await startDaemonServer({
    rpcServer: server,
    getDescriptor: () => descriptor,
    authToken: token,
    listenPort: 0,
  });
  t.after(() => daemon.close());
  const ledger = path.join(directory, "ssh-launch", computeSshStateKey(target));
  await mkdir(ledger, { recursive: true });
  await writeFile(path.join(ledger, "port"), String(daemon.port));
  await writeFile(path.join(ledger, "managed"), "managed");
  await writeFile(path.join(directory, "auth-token"), token);
  await writeFile(path.join(directory, "environment.json"), JSON.stringify({ environmentId: "probe-id" }));
  let socketCount = 0;
  daemon.server.on("upgrade", () => {
    socketCount++;
  });
  const script = buildRemoteProbeScript(target, "new");
  const probe = async () => {
    const { stdout } = await execute("sh", ["-c", script], {
      env: { ...process.env, SHELL: "/bin/sh" },
      timeout: 20_000,
      maxBuffer: 1024 * 1024,
    });
    const found = parseRemoteProbe(stdout);
    assert.equal(found.daemon.activeSessions, 0);
    return found;
  };
  for (const field of ["executingRuns", "cancellingRuns", "activeProbes"]) {
    activity = { executingRuns: 0, cancellingRuns: 0, activeProbes: 0, [field]: 1 };
    const found = await probe();
    assert.equal(found.daemon.activeAutomation, 1);
    assert.equal(planRuntimeUpgrade(found, "new").updatePending, true);
    assert.equal(socketCount, sessions);
  }
  activity = { executingRuns: 2, cancellingRuns: 3, activeProbes: 4 };
  assert.equal((await probe()).daemon.activeAutomation, 9);
  activity = { executingRuns: 0, cancellingRuns: 0, activeProbes: 0 };
  assert.equal(daemonIsIdle((await probe()).daemon), true);
  mode = "legacy";
  assert.equal((await probe()).daemon.activeAutomation, 0);
  for (mode of ["error", "timeout"]) {
    const found = await probe();
    assert.equal(found.daemon.activeAutomation, null);
    assert.equal(planRuntimeUpgrade(found, "new").updatePending, true);
  }
  assert.equal(sessions, 8);
  assert.equal(socketCount, 8);
});
