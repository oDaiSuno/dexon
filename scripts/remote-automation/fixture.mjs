import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { RemotePayloadCatalog } from "../../src/main/environments/remote-payload.ts";
import { buildPayloadInstallScript } from "../../src/main/environments/remote-provisioner.ts";
import {
  buildRemoteLaunchScript,
  buildRemoteStopScript,
  computeSshStateKey,
} from "../../src/main/environments/ssh-scripts.ts";
import { buildRemoteProbeScript, parseRemoteProbe } from "../../src/main/environments/remote-probe.ts";
import { fetchUnauthenticatedDescriptor, openRemoteConnection } from "../../src/main/environments/remote-endpoint.ts";
import { REMOTE_STOP_COMMAND_TIMEOUT_MS } from "../../src/shared/shutdown-budget.ts";

const execute = promisify(execFile);
export const root = path.resolve(import.meta.dirname, "../..");
export function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
    return false;
  }
}
export async function until(check, label, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await check();
    if (result) return result;
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
export async function disposeAll(...actions) {
  const errors = [];
  for (const action of actions) {
    try {
      await action();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length)
    throw new Error(`Cleanup failed: ${errors.map((error) => error.message).join("; ")}`, { cause: errors[0] });
}
export function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
export function isolatedDirectory(label) {
  const directory = mkdtempSync(path.join(tmpdir(), `dexon-${label}-`));
  const home = path.join(directory, "home");
  const cwd = path.join(directory, "workspace");
  const agent = path.join(directory, "agent");
  for (const dir of [home, cwd, agent]) mkdirSync(dir);
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_DATA_HOME: path.join(home, ".local", "share"),
    PI_CODING_AGENT_DIR: agent,
    PI_CODING_AGENT_SESSION_DIR: path.join(directory, "sessions"),
    PI_OFFLINE: "1",
  };
  delete env.PI_DESKTOP_USER_DATA;
  return { directory, home, cwd, agent, env };
}
export async function packagedDaemon(label, configure = () => {}) {
  const dirs = isolatedDirectory(label);
  const catalog = new RemotePayloadCatalog(path.join(root, "out/remote-payload"));
  const payload = catalog.forPlatform(process.platform, process.arch);
  const stateDir = path.join(dirs.directory, "server state's data");
  mkdirSync(stateDir);
  const target = { kind: "ssh", sshAlias: label, remoteStateDir: stateDir };
  const stateKey = computeSshStateKey(target);
  const ledger = path.join(stateDir, "ssh-launch", stateKey);
  const scriptOptions = { stateKey, remoteStateDir: stateDir, nodePath: process.execPath };
  const connections = new Set();
  const responses = [];
  const calls = [];
  let launch;
  let pid;
  const shell = async (script, timeout = 25000) =>
    (await execute("sh", ["-c", script], { env: dirs.env, timeout, maxBuffer: 1048576 })).stdout.trim();
  const fixture = {
    ...dirs,
    stateDir,
    ledger,
    target,
    responses,
    calls,
    get pid() {
      return pid;
    },
    get launch() {
      return launch;
    },
    get endpoint() {
      return {
        httpBaseUrl: `http://127.0.0.1:${launch.port}`,
        wsUrl: `ws://127.0.0.1:${launch.port}/rpc`,
        authToken: launch.authToken,
      };
    },
    async start() {
      launch = JSON.parse(
        await shell(
          buildRemoteLaunchScript({
            ...scriptOptions,
            preferredPort: 28790,
            daemonScriptPath: path.join(stateDir, "runtime", catalog.version, "index.mjs"),
          }),
        ),
      );
      pid = Number(readFileSync(path.join(ledger, "pid"), "utf8"));
      assert.equal(launch.ownership, "managed");
      assert.equal(alive(pid), true);
    },
    async connect() {
      const descriptor = await fetchUnauthenticatedDescriptor(
        fixture.endpoint.httpBaseUrl,
        undefined,
        undefined,
        undefined,
        launch.authToken,
      );
      const connection = await openRemoteConnection(fixture.endpoint, descriptor, undefined, {
        businessTimeoutMs: 15000,
      });
      connection.channel.onMessage((message) => responses.push(message));
      const originalCall = connection.rpc.call.bind(connection.rpc);
      connection.rpc.call = (method, ...args) => {
        calls.push({ method, atMs: Date.now() });
        return originalCall(method, ...args);
      };
      connections.add(connection);
      connection.channel.onClose(() => connections.delete(connection));
      assert.equal((await connection.rpc.call("host.ping")).ok, true);
      return connection;
    },
    probe: async () => parseRemoteProbe(await shell(buildRemoteProbeScript(target, catalog.version))),
    log: () =>
      existsSync(path.join(ledger, "daemon.log")) ? readFileSync(path.join(ledger, "daemon.log"), "utf8") : "",
    async stop() {
      const beforePid = pid;
      const startedAt = Date.now();
      const { stdout: result } = await execute("sh", ["-c", buildRemoteStopScript(scriptOptions)], {
        env: dirs.env,
        timeout: REMOTE_STOP_COMMAND_TIMEOUT_MS,
      });
      assert.equal(result, "stopped");
      assert.equal(alive(beforePid), false);
      const ledgerCleaned = ["pid", "port", "managed"].every((name) => !existsSync(path.join(ledger, name)));
      assert.equal(ledgerCleaned, true);
      assert.equal(existsSync(path.join(stateDir, "daemon-owner.lock")), false);
      assert.doesNotMatch(fixture.log(), /shutdown deadline reached|shutdown failed:/);
      return {
        beforePid,
        result,
        elapsedMs: Date.now() - startedAt,
        ledgerCleaned,
        processExited: true,
        cleanShutdown: true,
      };
    },
    async dispose() {
      for (const connection of connections) connection.close();
      try {
        if (launch && existsSync(path.join(ledger, "managed"))) await fixture.stop();
      } finally {
        rmSync(dirs.directory, { recursive: true, force: true });
      }
    },
  };
  try {
    await configure(fixture);
    await new Promise((resolve, reject) => {
      const install = execFile(
        "sh",
        ["-c", buildPayloadInstallScript(target, process.execPath, catalog.version, payload)],
        { env: dirs.env, timeout: 30000 },
        (error) => (error ? reject(error) : resolve()),
      );
      install.stdin.on("error", reject);
      install.stdin.end(readFileSync(payload.path));
    });
    await fixture.start();
    return fixture;
  } catch (error) {
    console.error(fixture.log());
    await fixture.dispose();
    throw error;
  }
}
export const task = (cwd, id, steps, extra = {}) => ({
  schema: "dexon.automation/v1",
  id,
  name: id,
  cwd,
  triggers: [{ id: "manual", kind: "manual" }],
  steps,
  ...extra,
});
export const http = (id, origin, requestPath, extra = {}) => ({
  kind: "action",
  id,
  call: {
    action: "http.request",
    with: {
      url: { origin, path: requestPath },
      method: "POST",
      body: { ok: true },
      effect: { idempotent: { window: "forever" } },
      ...extra,
    },
  },
});
export const approval = (id, extra = {}) => ({
  kind: "wait",
  id,
  wait: { kind: "approval", title: "Approve remote action" },
  ...extra,
});
export async function startRun(rpc, taskId, input = null) {
  const result = await rpc.call("automation.startRun", { taskId, triggerId: "manual", input });
  assert.equal(result.outcome, "admitted");
  assert.ok(result.runId);
  return result.runId;
}
export async function phase(rpc, runId, expected) {
  return until(async () => {
    const { run } = await rpc.call("automation.getRun", { runId });
    if (["failed", "attention", "cancelled"].includes(run.phase) && run.phase !== expected)
      throw new Error(`Run ${runId}: ${JSON.stringify(run)}`);
    return run.phase === expected && run;
  }, `run ${runId} ${expected}`);
}
