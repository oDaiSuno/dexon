import { createHash } from "node:crypto";
import type { SshEnvironmentTarget } from "../../contract/environment.ts";

export function shellQuote(value: string): string {
  if (/\0/u.test(value)) throw new Error("Invalid remote shell argument");
  return `'${value.replace(/'/gu, `'"'"'`)}'`;
}

export function validateSshTarget(target: SshEnvironmentTarget): void {
  if (typeof target.sshAlias !== "string" || !/^[a-z0-9][a-z0-9._-]{0,252}$/iu.test(target.sshAlias))
    throw new Error("Invalid SSH alias");
  if (
    target.hostname !== undefined &&
    (typeof target.hostname !== "string" || !/^[a-z0-9:][a-z0-9.:%-]{0,252}$/iu.test(target.hostname))
  )
    throw new Error("Invalid SSH hostname");
  if (
    target.user !== undefined &&
    (typeof target.user !== "string" || !/^[a-z_][a-z0-9_.-]{0,63}$/iu.test(target.user))
  )
    throw new Error("Invalid SSH user");
  for (const port of [target.port, target.remotePort]) {
    if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535))
      throw new Error("Invalid SSH port");
  }
  if (target.remoteStateDir !== undefined) validateRemotePath(target.remoteStateDir);
}

function validateRemotePath(value: string): void {
  if (typeof value !== "string" || value.length > 4096 || !/^(?:\/|~\/)/u.test(value) || /[\0\r\n]/u.test(value))
    throw new Error("Invalid remote path");
}

export function remotePath(value: string | undefined, fallback: string): string {
  if (value === undefined) return `"$HOME"/${shellQuote(fallback)}`;
  validateRemotePath(value);
  return value.startsWith("~/") ? `"$HOME"/${shellQuote(value.slice(2))}` : shellQuote(value);
}

export function targetConnectionKey(target: SshEnvironmentTarget): string {
  validateSshTarget(target);
  return JSON.stringify([
    target.sshAlias,
    target.hostname ?? null,
    target.user ?? null,
    target.port ?? 22,
    target.remotePort ?? 3780,
    target.remoteStateDir ?? "~/.dexon",
  ]);
}

export function computeSshStateKey(target: SshEnvironmentTarget): string {
  return createHash("sha256").update(targetConnectionKey(target)).digest("hex").slice(0, 16);
}

function ledgerPath(stateKey: string, stateDir?: string): string {
  if (!/^[a-f0-9]{16}$/u.test(stateKey)) throw new Error("Invalid SSH state key");
  return `${remotePath(stateDir, ".dexon")}/ssh-launch/${stateKey}`;
}

export function buildRemoteLaunchScript(options: {
  stateKey: string;
  preferredPort: number;
  remoteStateDir?: string;
  daemonScriptPath?: string;
  nodePath?: string;
}): string {
  const port = options.preferredPort ?? 3780;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid preferred remote port");
  return `set -eu\numask 077\n${options.nodePath ? shellQuote(options.nodePath) : "node"} - ${ledgerPath(options.stateKey, options.remoteStateDir)} ${port} ${remotePath(options.remoteStateDir, ".dexon")} ${remotePath(options.daemonScriptPath, ".dexon/agent-host/index.mjs")} ${shellQuote(options.stateKey)} <<'DEXON_LAUNCH'\n${String.raw`const fs = require("node:fs");
const http = require("node:http");
const crypto = require("node:crypto");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");
const [ledger, preferred, stateDir, daemonEntry, stateKey] = process.argv.slice(2);
const legacy = path.join(process.env.HOME, ".dexon", "ssh-launch", stateKey);
const file = name => path.join(ledger, name);
const read = name => { try { return fs.readFileSync(file(name), "utf8").trim(); } catch (error) { if (error.code !== "ENOENT") throw error; try { return fs.readFileSync(path.join(legacy, name), "utf8").trim(); } catch { return ""; } } };
const write = (name, value) => fs.writeFileSync(file(name), String(value), { mode: 0o600 });
const alive = pid => { if (!/^[1-9][0-9]*$/.test(pid) || Number(pid) <= 1) return false; try { process.kill(Number(pid), 0); return true; } catch (error) { return error.code === "EPERM"; } };
const readTokenAndEnvId = () => {
  try {
    const authToken = fs.readFileSync(path.join(stateDir, "auth-token"), "utf8").trim();
    const { environmentId } = JSON.parse(fs.readFileSync(path.join(stateDir, "environment.json"), "utf8"));
    return /^[a-f0-9]{64}$/.test(authToken) && typeof environmentId === "string" && environmentId.length > 0 ? { authToken, environmentId } : null;
  } catch { return null; }
};
const probe = port => new Promise(resolve => {
  const info = readTokenAndEnvId();
  if (!info || !/^[1-9][0-9]{0,4}$/.test(String(port)) || Number(port) > 65535) return resolve(false);
  const nonce = crypto.randomBytes(16).toString("hex");
  const request = http.get({ hostname: "127.0.0.1", port, path: "/.well-known/dexon/environment", headers: { "x-dexon-nonce": nonce }, timeout: 1000 }, response => {
    let body = "";
    response.on("data", chunk => { body += chunk; if (body.length > 65536) request.destroy(); });
    response.on("error", () => resolve(false));
    response.on("end", () => {
      try {
        resolve(response.statusCode === 200 && response.headers["x-dexon-proof"] === crypto.createHmac("sha256", info.authToken).update(nonce).digest("hex") && JSON.parse(body).environmentId === info.environmentId);
      } catch { resolve(false); }
    });
  });
  request.on("timeout", () => request.destroy());
  request.on("error", () => resolve(false));
});
const free = port => new Promise(resolve => {
  const server = net.createServer();
  server.once("error", () => resolve(false));
  server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
});
const finish = (port, ownership) => {
  const authToken = fs.readFileSync(path.join(stateDir, "auth-token"), "utf8").trim();
  if (!/^[a-f0-9]{64}$/.test(authToken)) throw new Error("Invalid remote auth token");
  process.stdout.write(JSON.stringify({ port: Number(port), ownership, authToken }) + "\n");
};
const acquireLaunchLock = async () => {
  const lockPath = file("launch.lock");
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid }), { flag: "wx", mode: 0o600 });
      return () => {
        try {
          if (JSON.parse(fs.readFileSync(lockPath, "utf8")).pid === process.pid) fs.rmSync(lockPath, { force: true });
        } catch (error) { if (error.code !== "ENOENT") throw error; }
      };
    } catch (error) { if (error.code !== "EEXIST") throw error; }
    let existing;
    try { existing = fs.readFileSync(lockPath, "utf8"); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
    let ownerPid;
    try { ownerPid = JSON.parse(existing).pid; } catch { ownerPid = null; }
    if (!alive(String(ownerPid))) {
      try {
        if (fs.readFileSync(lockPath, "utf8") === existing) fs.rmSync(lockPath, { force: true });
      } catch (error) { if (error.code !== "ENOENT") throw error; }
      continue;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error("Remote launch lock timed out");
};
(async () => {
  fs.mkdirSync(ledger, { recursive: true, mode: 0o700 });
  const release = await acquireLaunchLock();
  try {
    const ownership = read("managed");
    const previousPort = read("port");
    if (ownership === "external" && await probe(previousPort)) return finish(previousPort, "external");
    if (ownership === "managed" && alive(read("pid")) && await probe(previousPort)) return finish(previousPort, "managed");
    if (await probe(preferred)) {
      write("port", preferred);
      write("managed", "external");
      fs.rmSync(file("pid"), { force: true });
      return finish(preferred, "external");
    }
    let port = Number(preferred);
    const lastPort = Math.min(65535, Number(preferred) + 200);
    while (port <= lastPort && !await free(port)) port += 1;
    if (port > lastPort) throw new Error("No free remote loopback port");
    if (!fs.existsSync(daemonEntry) || !fs.statSync(daemonEntry).isFile()) throw new Error("Invalid remote daemon entry");
    fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    const quote = value => "'" + value.replace(/'/g, "'\"'\"'") + "'";
    const args = [process.execPath, daemonEntry, "--listen", "127.0.0.1:" + port, "--state-dir", stateDir];
    write("run-dexon.sh", "exec " + args.map(quote).join(" ") + "\n");
    const log = fs.openSync(file("daemon.log"), "a", 0o600);
    const child = spawn("nohup", ["sh", file("run-dexon.sh")], { detached: true, stdio: ["ignore", log, log] });
    try { await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); }); } finally { fs.closeSync(log); }
    child.unref();
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (!alive(String(child.pid))) throw new Error("Remote daemon exited during startup");
      if (await probe(port)) {
        write("pid", child.pid);
        write("port", port);
        write("managed", "managed");
        return finish(port, "managed");
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error("Remote daemon startup timed out");
  } finally { release(); }
})().catch(error => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });`}
DEXON_LAUNCH`;
}

export function buildRemoteStopScript(options: {
  stateKey: string;
  remoteStateDir?: string;
  nodePath?: string;
}): string {
  return `set -eu
${options.nodePath ? shellQuote(options.nodePath) : "node"} - ${ledgerPath(options.stateKey, options.remoteStateDir)} ${remotePath(options.remoteStateDir, ".dexon")} ${shellQuote(options.stateKey)} <<'DEXON_STOP'
${String.raw`const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
let [ledger, state, key] = process.argv.slice(2);
if (!fs.existsSync(path.join(ledger, "managed"))) ledger = path.join(process.env.HOME, ".dexon", "ssh-launch", key);
const read = name => { try { return fs.readFileSync(path.join(ledger, name), "utf8").trim(); } catch { return ""; } };
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; } };
(async () => {
  if (read("managed") !== "managed") return process.stdout.write("not-owned");
  const pid = Number(read("pid")), port = Number(read("port"));
  if (!Number.isInteger(pid) || pid <= 1 || !Number.isInteger(port) || port < 1 || port > 65535) return process.stdout.write("not-owned");
  if (alive(pid)) {
    const owner = JSON.parse(fs.readFileSync(path.join(state, "daemon-owner.lock"), "utf8"));
    if (owner.pid !== pid) return process.stdout.write("not-owned");
    const token = fs.readFileSync(path.join(state, "auth-token"), "utf8").trim();
    const identity = JSON.parse(fs.readFileSync(path.join(state, "environment.json"), "utf8"));
    const nonce = crypto.randomBytes(16).toString("hex");
    const response = await fetch("http://127.0.0.1:" + port + "/.well-known/dexon/environment", { headers: { "x-dexon-nonce": nonce }, signal: AbortSignal.timeout(2000) });
    if (response.headers.get("x-dexon-proof") !== crypto.createHmac("sha256", token).update(nonce).digest("hex") || (await response.json()).environmentId !== identity.environmentId) throw new Error("Remote daemon ownership could not be verified");
    process.kill(pid, "SIGTERM");
    const deadline = Date.now() + 3000;
    while (alive(pid) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
    if (alive(pid)) throw new Error("Remote daemon did not stop within 3 seconds");
  }
  for (const name of ["pid", "port", "managed"]) fs.rmSync(path.join(ledger, name), { force: true });
  process.stdout.write("stopped");
})().catch(error => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });`}
DEXON_STOP`;
}
