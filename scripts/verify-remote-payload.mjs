import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildPayloadInstallScript } from "../src/main/environments/remote-provisioner.ts";
import { RemotePayloadCatalog } from "../src/main/environments/remote-payload.ts";
import {
  buildRemoteLaunchScript,
  buildRemoteStopScript,
  computeSshStateKey,
} from "../src/main/environments/ssh-scripts.ts";
import { fetchUnauthenticatedDescriptor, openRemoteConnection } from "../src/main/environments/remote-endpoint.ts";
const execute = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const catalog = new RemotePayloadCatalog(path.join(root, "out", "remote-payload"));
const payload = catalog.forPlatform(process.platform, process.arch);
const temporary = mkdtempSync(path.join(tmpdir(), "dexon-remote-artifact-"));
const stateDir = path.join(temporary, "state's data");
const home = path.join(temporary, "home");
mkdirSync(home);
const env = {
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  XDG_CONFIG_HOME: path.join(home, ".config"),
  XDG_DATA_HOME: path.join(home, ".local", "share"),
  PI_CODING_AGENT_DIR: path.join(temporary, "agent"),
  PI_CODING_AGENT_SESSION_DIR: path.join(temporary, "sessions"),
  PI_OFFLINE: "1",
};
delete env.PI_DESKTOP_USER_DATA;
const target = { kind: "ssh", sshAlias: "artifact", remoteStateDir: stateDir };
const stateKey = computeSshStateKey(target);
const scriptOptions = { stateKey, remoteStateDir: stateDir, nodePath: process.execPath };
let connection;
let launch;
let shutdown;
try {
  const script = buildPayloadInstallScript(target, process.execPath, catalog.version, payload);
  const install = execFile("sh", ["-c", script], { env, timeout: 30000, maxBuffer: 262144 });
  const installed = new Promise((resolve, reject) =>
    install
      .once("exit", (code) => (code === 0 ? resolve() : reject(new Error("Payload install failed"))))
      .once("error", reject),
  );
  install.stdin.end(readFileSync(payload.path));
  await installed;
  const daemonScriptPath = path.join(stateDir, "runtime", catalog.version, "index.mjs");
  launch = JSON.parse(
    (
      await execute(
        "sh",
        ["-c", buildRemoteLaunchScript({ ...scriptOptions, preferredPort: 28780, daemonScriptPath })],
        { env, timeout: 25000 },
      )
    ).stdout,
  );
  const endpoint = {
    httpBaseUrl: `http://127.0.0.1:${launch.port}`,
    wsUrl: `ws://127.0.0.1:${launch.port}/rpc`,
    authToken: launch.authToken,
  };
  const descriptor = await fetchUnauthenticatedDescriptor(
    endpoint.httpBaseUrl,
    undefined,
    undefined,
    undefined,
    launch.authToken,
  );
  connection = await openRemoteConnection(endpoint, descriptor);
  assert.equal((await connection.rpc.call("host.ping")).ok, true);
  assert.equal(descriptor.runtime.payloadVersion, catalog.version);
  assert.equal(descriptor.runtime.nodeVersion, process.versions.node);
  const listing = await connection.rpc.call("projects.browse", { path: home });
  assert.equal(listing.ok, true);
  const sessions = await connection.rpc.call("sessions.list");
  assert.deepEqual(sessions.runningSessionIds, []);
  connection.close();
  connection = undefined;
  shutdown = (await execute("sh", ["-c", buildRemoteStopScript(scriptOptions)], { env, timeout: 10000 })).stdout.trim();
  assert.equal(shutdown, "stopped");
  const receipt = {
    payloadVersion: catalog.version,
    os: process.platform,
    arch: process.arch,
    installed: true,
    ownership: launch.ownership,
    descriptor,
    rpcPing: true,
    folderBrowse: true,
    runningSessions: 0,
    shutdown,
  };
  const receiptPath = process.argv[2] ?? path.join(root, ".artifacts", "remote-payload-verification.json");
  mkdirSync(path.dirname(receiptPath), { recursive: true });
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify(receipt, null, 2));
} catch (error) {
  try {
    console.error(readFileSync(path.join(stateDir, "ssh-launch", stateKey, "daemon.log"), "utf8"));
  } catch {
    console.error("Remote daemon log is unavailable");
  }
  throw error;
} finally {
  connection?.close();
  if (launch && shutdown !== "stopped")
    await execute("sh", ["-c", buildRemoteStopScript(scriptOptions)], { env, timeout: 10000 }).catch(() => {});
  rmSync(temporary, { recursive: true, force: true });
}
