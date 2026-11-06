import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { createElectronTestEnvironment } from "../../scripts/electron-test-environment.mjs";

export const remoteSettingsScenes = [
  "01-production-startup",
  "02-six-tabs-and-general",
  "03-servers-zero-state",
  "04-ssh-discovery-and-manual",
  "05-edit-and-test-report",
  "06-reachable-card-metadata",
  "07-picker-home-and-columns",
  "08-picker-errors-preserve-workspace",
  "09-picker-cancel-does-not-mount",
  "10-picker-confirm-mounts",
  "11-policy-persists",
  "12-light-dark-visuals",
  "13-removal-choices",
];

export const remoteSettingsLabels = {
  tabs: ["General", "Models", "Browser", "Developer Tools", "Servers", "About"],
  add: "Add server",
  addDialog: "Add remote server",
  editDialog: "Edit remote server",
  manual: "Enter connection details",
  advanced: "Advanced options (optional)",
  label: "Display name",
  alias: "Host or SSH alias",
  hostname: "Hostname override (optional)",
  user: "SSH user (optional)",
  port: "SSH port",
  identity: "Identity file",
  jump: "Jump host (ProxyJump)",
  remotePort: "Remote service port",
  stateDir: "Remote data directory",
  save: "Save changes",
  test: "Test connection",
  edit: "Edit",
  remove: "Remove",
  picker: "Add a project space from a remote server",
  path: "Remote folder path",
  go: "Go ↵",
  confirm: "Mount project space",
  keep: "Keep the remote service running (recommended)",
  stop: "Stop the remote service too",
  removeDialog: "Remove remote server?",
  removeKeep: "Remove from this computer",
  removeStop: "Remove and stop remote service",
  externalDaemon: "Externally managed service",
  detached: "Run independently of this desktop",
  reconnect: "Reconnect and recover session output automatically",
};

export const remoteSettingsDialogWidths = { discovery: 660, manual: 624, edit: 624, remove: 624 };

export const remoteSettingsServer = {
  label: "Local production daemon",
  editedLabel: "Renamed production daemon",
  sshAlias: "remote-settings-local",
  manualLabel: "Manual localhost fixture",
  manualAlias: "remote-settings-manual",
};

function cleanEnvironment(env) {
  const result = { ...env };
  for (const key of ["PI_DESKTOP_USER_DATA", "SSH_AUTH_SOCK", "SSH_AGENT_PID", "SSH_ASKPASS", "GIT_ASKPASS"]) {
    delete result[key];
  }
  return result;
}

export async function seedRemoteSettingsNative() {
  const home = process.env.PI_DESKTOP_SMOKE_HOME;
  if (!home || !path.isAbsolute(home) || home !== process.env.HOME || process.env.PI_DESKTOP_USER_DATA) {
    throw new Error("Remote settings requires an isolated smoke home without inherited desktop data");
  }
  for (const key of ["SSH_AUTH_SOCK", "SSH_AGENT_PID", "SSH_ASKPASS", "GIT_ASKPASS"]) delete process.env[key];
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve an unreachable local SSH port");
  const sshPort = address.port;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  const directory = path.join(home, ".ssh");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const identityFile = path.join(directory, "fixture-key-does-not-exist");
  const config = path.join(directory, "config");
  fs.writeFileSync(
    config,
    [
      `Host ${remoteSettingsServer.sshAlias} ${remoteSettingsServer.manualAlias}`,
      "  HostName 127.0.0.1",
      "  User fixture",
      `  Port ${sshPort}`,
      `  IdentityFile ${JSON.stringify(identityFile)}`,
      "  IdentitiesOnly yes",
      "  IdentityAgent none",
      "  BatchMode yes",
      "  ConnectTimeout 2",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  return { home, config, identityFile, sshPort };
}

export async function startRemoteSettingsDaemon({ root, node, output }) {
  if (!node || !path.isAbsolute(node)) throw new Error("The production daemon requires an explicit Node executable");
  const sandbox = createElectronTestEnvironment(cleanEnvironment(process.env));
  const home = fs.realpathSync.native(sandbox.env.HOME);
  const workspace = path.join(home, "workspace");
  const project = path.join(workspace, "project");
  const empty = path.join(workspace, "empty");
  const missing = path.join(workspace, "missing-project");
  const file = path.join(workspace, "not-a-directory.txt");
  const stateDir = path.join(sandbox.directory, "daemon-state");
  const denied = process.platform !== "win32" && process.getuid?.() !== 0 ? path.join(workspace, "denied") : null;
  fs.mkdirSync(path.join(project, ".git"), { recursive: true });
  fs.mkdirSync(empty, { recursive: true });
  fs.writeFileSync(path.join(project, ".git", "HEAD"), "ref: refs/heads/main\n");
  fs.writeFileSync(file, "This fixture is a file, not a directory.\n");
  if (denied) {
    fs.mkdirSync(denied);
    fs.chmodSync(denied, 0);
  }
  const entry = path.join(root, "out/agent-host/index.mjs");
  const args = [entry, "--listen", "127.0.0.1:0", "--state-dir", stateDir, "--label", remoteSettingsServer.label];
  const child = spawn(node, args, {
    cwd: root,
    env: {
      ...cleanEnvironment(sandbox.env),
      HOME: home,
      USERPROFILE: home,
      DEXON_REMOTE_PAYLOAD_VERSION: "development",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let log = "";
  let spawnError;
  let disposed;
  const isAlive = () => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null || spawnError) return false;
    try {
      process.kill(child.pid, 0);
      return true;
    } catch (error) {
      if (error.code === "EPERM") return true;
      if (error.code === "ESRCH") return false;
      throw error;
    }
  };
  const append = (chunk) => {
    log = (log + chunk.toString()).slice(-131072);
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  child.on("error", (error) => {
    spawnError = error;
  });
  const dispose = () => {
    disposed ??= (async () => {
      if (child.exitCode === null && child.signalCode === null && child.pid) {
        await new Promise((resolve) => {
          const finish = () => {
            clearTimeout(timer);
            clearTimeout(forceTimer);
            child.removeListener("close", finish);
            resolve();
          };
          const forceTimer = setTimeout(() => child.kill("SIGKILL"), 2500);
          const timer = setTimeout(finish, 5000);
          child.once("close", finish);
          child.kill("SIGTERM");
        });
      }
      fs.writeFileSync(path.join(output, "daemon.log"), log);
      if (isAlive()) throw new Error(`Production daemon PID ${child.pid} survived cleanup`);
      if (denied) fs.chmodSync(denied, 0o700);
      sandbox.dispose();
    })();
    return disposed;
  };
  try {
    let endpoint;
    const deadline = Date.now() + 20000;
    while (!endpoint) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Production daemon exited: ${log}`);
      const match = /daemon listening on http:\/\/127\.0\.0\.1:(\d+)/u.exec(log);
      if (match) endpoint = `ws://127.0.0.1:${match[1]}/rpc`;
      else if (Date.now() >= deadline) throw new Error(`Production daemon startup exceeded 20s: ${log}`);
      else await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const authToken = fs.readFileSync(path.join(stateDir, "auth-token"), "utf8").trim();
    const identity = JSON.parse(fs.readFileSync(path.join(stateDir, "environment.json"), "utf8"));
    return {
      pid: child.pid,
      entry,
      args,
      endpoint,
      authToken,
      environmentId: identity.environmentId,
      home,
      workspace,
      project,
      empty,
      missing,
      file,
      denied,
      dispose,
      isAlive,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}
