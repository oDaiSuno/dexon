import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createElectronTestEnvironment } from "../../scripts/electron-test-environment.mjs";

export const remoteProjectsScenes = [
  "01-production-startup",
  "02-unified-online-sidebar",
  "03-remote-menu-actions",
  "04-project-source-choices",
  "05-policy-honest-welcome-and-topbar",
  "06-disabled-remote-affordances",
  "07-environment-scoped-files",
  "08-outage-draft-and-immediate-retry",
  "09-offline-and-blocked-diagnosis",
  "10-zero-session-restart-restores-files",
  "11-one-time-session-root-migration",
  "12-light-dark-evidence",
];

export const remoteProjectLabels = {
  alpha: "Proof alpha long server name",
  beta: "Proof beta",
  picker: "Add a project space from a remote server",
  path: "Remote folder path",
  confirm: "Mount project space",
  local: "Add project space from folder…",
  remote: "Add project space from remote server…",
  settings: "Connect a remote server…",
  copy: "Copy remote path",
  newSession: "New session in this project",
  serverSettings: "Server connection settings…",
  finder: "Show in Finder",
  remove: "Remove project space from sidebar",
};

function cleanEnvironment(environment) {
  const result = { ...environment };
  for (const key of ["PI_DESKTOP_USER_DATA", "SSH_AUTH_SOCK", "SSH_AGENT_PID", "SSH_ASKPASS", "GIT_ASKPASS"])
    delete result[key];
  return result;
}

export function seedRemoteProjectsNative() {
  const home = process.env.PI_DESKTOP_SMOKE_HOME;
  if (!home || !path.isAbsolute(home) || home !== process.env.HOME || process.env.PI_DESKTOP_USER_DATA)
    throw new Error("Remote project proof requires a disposable smoke home and no inherited desktop data");
  for (const key of ["SSH_AUTH_SOCK", "SSH_AGENT_PID", "SSH_ASKPASS", "GIT_ASKPASS"]) delete process.env[key];
  const canonicalHome = fs.realpathSync.native(home);
  const project = path.join(canonicalHome, "unit5-shared-project");
  const migrationProject = path.join(canonicalHome, "unit5-migrated-project");
  const localProject = path.join(canonicalHome, "unit5-local-project");
  for (const directory of [project, migrationProject, localProject]) fs.mkdirSync(directory, { recursive: true });
  fs.mkdirSync(path.join(project, ".git"), { recursive: true });
  fs.writeFileSync(path.join(project, ".git", "HEAD"), "ref: refs/heads/proof-main\n");
  const text = path.join(project, "scope-proof.txt");
  const image = path.join(project, "scope-proof.svg");
  const markers = {
    alpha: "ALPHA production daemon file bytes",
    beta: "BETA production daemon file bytes",
  };
  const stage = (server) => {
    const marker = markers[server];
    fs.writeFileSync(text, `${marker}\n`);
    fs.writeFileSync(
      image,
      `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160"><rect width="320" height="160" fill="${server === "alpha" ? "#2563eb" : "#e11d48"}"/><text x="12" y="80" fill="white">${marker}</text></svg>`,
    );
    return marker;
  };
  stage("alpha");
  return {
    home,
    project,
    localProject,
    migrationProject,
    text,
    image,
    markers,
    stage,
    filesystemModel:
      "Staged shared host filesystem. Both independent daemon processes can access the identical canonical path. Bytes are staged before each separate daemon read; this is not a claim of physically separate remote disks.",
  };
}

export async function startRemoteProjectsDaemon({ root, node, output, label, name, history }) {
  if (!node || !path.isAbsolute(node)) throw new Error("The daemon needs an explicit production Node executable");
  const sandbox = createElectronTestEnvironment(cleanEnvironment(process.env));
  const home = fs.realpathSync.native(sandbox.env.HOME);
  const entry = path.join(root, "out/agent-host/index.mjs");
  let stateDir = path.join(sandbox.directory, "daemon-state");
  let child;
  let port = 0;
  let log = "";
  let spawnError;
  let identity;
  let authToken;
  let args;
  let disposed = false;
  const generations = [];
  let seededHistory;
  if (history) {
    const { SessionManager } = await import("@earendil-works/pi-coding-agent");
    const manager = SessionManager.create(history.cwd, sandbox.env.PI_CODING_AGENT_SESSION_DIR);
    manager.appendMessage({ role: "user", content: "Existing remote history before the Unit 5 upgrade", timestamp: 1 });
    manager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "Persisted historical session, no provider request is made." }],
      api: "openai-responses",
      provider: "proof-fixture",
      model: "offline-history",
      stopReason: "stop",
      timestamp: 2,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    });
    manager.appendSessionInfo(history.title);
    seededHistory = {
      sessionId: manager.getSessionId(),
      cwd: history.cwd,
      title: history.title,
      source: "Actual SDK SessionManager persisted transcript fixture",
    };
  }
  const isAlive = () => {
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null || spawnError) return false;
    try {
      process.kill(child.pid, 0);
      return true;
    } catch (error) {
      if (error.code === "EPERM") return true;
      if (error.code === "ESRCH") return false;
      throw error;
    }
  };
  const stop = async () => {
    if (!isAlive()) return;
    const stopped = child;
    await new Promise((resolve, reject) => {
      const force = setTimeout(() => stopped.kill("SIGKILL"), 2500);
      const deadline = setTimeout(() => reject(new Error(`Daemon ${name} did not stop`)), 6000);
      stopped.once("close", () => {
        clearTimeout(force);
        clearTimeout(deadline);
        resolve();
      });
      stopped.kill("SIGTERM");
    });
  };
  const start = async () => {
    if (disposed || isAlive()) throw new Error(`Daemon ${name} cannot start in its current lifecycle state`);
    spawnError = null;
    let startup = "";
    args = [entry, "--listen", `127.0.0.1:${port}`, "--state-dir", stateDir, "--label", label];
    child = spawn(node, args, {
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
    const append = (chunk) => {
      const text = chunk.toString();
      startup += text;
      log = (log + text).slice(-262144);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", (error) => {
      spawnError = error;
    });
    const deadline = Date.now() + 20000;
    for (;;) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Daemon ${name} exited: ${startup}`);
      const match = /daemon listening on http:\/\/127\.0\.0\.1:(\d+)/u.exec(startup);
      if (match) {
        port = Number(match[1]);
        break;
      }
      if (Date.now() >= deadline) throw new Error(`Daemon ${name} startup exceeded 20s: ${startup}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    authToken = fs.readFileSync(path.join(stateDir, "auth-token"), "utf8").trim();
    identity = JSON.parse(fs.readFileSync(path.join(stateDir, "environment.json"), "utf8"));
    generations.push({ pid: child.pid, environmentId: identity.environmentId, startedAt: Date.now(), stateDir });
  };
  const dispose = async () => {
    if (disposed) return;
    await stop();
    fs.writeFileSync(path.join(output, `${name}-daemon.log`), log);
    if (isAlive()) throw new Error(`Daemon ${name} survived cleanup`);
    sandbox.dispose();
    disposed = true;
  };
  try {
    await start();
    return {
      get pid() {
        return child.pid;
      },
      get args() {
        return args;
      },
      get endpoint() {
        return `ws://127.0.0.1:${port}/rpc`;
      },
      get authToken() {
        return authToken;
      },
      get environmentId() {
        return identity.environmentId;
      },
      entry,
      home,
      generations,
      seededHistory,
      isAlive,
      stop,
      start,
      dispose,
      async rpc(method, params) {
        const url = new URL(`ws://127.0.0.1:${port}/rpc`);
        url.searchParams.set("token", authToken);
        const socket = new globalThis.WebSocket(url);
        return new Promise((resolve, reject) => {
          const finish = (error, result) => {
            clearTimeout(deadline);
            socket.close();
            if (error) reject(error);
            else resolve(result);
          };
          const deadline = setTimeout(() => finish(new Error(`Daemon RPC ${method} exceeded 10s`)), 10000);
          socket.addEventListener("open", () =>
            socket.send(JSON.stringify({ kind: "request", id: "fixture-read", method, params })),
          );
          socket.addEventListener("error", () => finish(new Error(`Daemon RPC ${method} transport failed`)));
          socket.addEventListener("message", (event) => {
            const message = JSON.parse(event.data);
            if (message.kind !== "response" || message.id !== "fixture-read") return;
            finish(message.ok ? null : new Error(JSON.stringify(message.error)), message.result);
          });
        });
      },
      async restart() {
        await stop();
        await start();
      },
      async replaceIdentity() {
        await stop();
        const previousToken = authToken;
        stateDir = path.join(sandbox.directory, `replacement-state-${generations.length}`);
        fs.mkdirSync(stateDir, { recursive: true });
        fs.writeFileSync(path.join(stateDir, "auth-token"), `${previousToken}\n`, { mode: 0o600 });
        await start();
      },
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}
