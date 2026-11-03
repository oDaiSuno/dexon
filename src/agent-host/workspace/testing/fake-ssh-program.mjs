import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";

const FALLBACK_KEY = {
  type: "ssh-ed25519",
  blob: "AAAAC3NzaC1lZDI1NTE5AAAAILTeFB4/nzVyeC8AD1sIm+msF3j0rgd+XKKJAaq8vRox",
};

function readScenario() {
  const file = process.env.DEXON_FAKE_SSH_SCENARIO;
  if (!file) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function hostEntry(host) {
  const scenario = readScenario();
  return { ...(scenario.default ?? {}), ...(scenario.hosts?.[host] ?? {}) };
}

function parseArgs(argv) {
  const parsed = { options: new Map(), port: 22, control: null, forward: null, master: false };
  let index = 0;
  for (; index < argv.length; index += 1) {
    const word = argv[index];
    if (word === "--") {
      index += 1;
      break;
    }
    if (word === "-o") {
      const [name, ...rest] = argv[(index += 1)].split("=");
      parsed.options.set(name, rest.join("="));
    } else if (word === "-p") parsed.port = Number(argv[(index += 1)]);
    else if (word === "-O") parsed.control = argv[(index += 1)];
    else if (word === "-L") parsed.forward = argv[(index += 1)];
    else if (word === "-N") parsed.master = true;
    else if (word === "-i") index += 1;
  }
  const destination = argv[index];
  const at = destination.lastIndexOf("@");
  parsed.user = at >= 0 ? destination.slice(0, at) : (process.env.USER ?? "user");
  parsed.host = at >= 0 ? destination.slice(at + 1) : destination;
  parsed.remoteCommand = argv.slice(index + 1).join(" ") || null;
  return parsed;
}

function fail(message, code = 255) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function knownHostsFiles(parsed) {
  const value = parsed.options.get("UserKnownHostsFile") ?? "";
  const quoted = [...value.matchAll(/"([^"]*)"|(\S+)/g)].map((match) => match[1] ?? match[2]);
  return quoted;
}

function hostPattern(parsed) {
  return parsed.port === 22 ? parsed.host : `[${parsed.host}]:${parsed.port}`;
}

function verifyHostKey(parsed) {
  const entry = hostEntry(parsed.host);
  const key = entry.hostKey ?? FALLBACK_KEY;
  const pattern = hostPattern(parsed);
  const files = knownHostsFiles(parsed);
  let sameType = false;
  for (const file of files) {
    let fileText;
    try {
      fileText = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of fileText.split("\n")) {
      const [hosts, type, blob] = line.trim().split(/\s+/);
      if (!hosts || !hosts.split(",").includes(pattern) || type !== key.type) continue;
      if (blob === key.blob) return;
      sameType = true;
    }
  }
  if (sameType) {
    fail(
      "@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\n@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\n@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\nHost key verification failed.",
    );
  }
  const policy = parsed.options.get("StrictHostKeyChecking");
  if (policy === "accept-new" || policy === "no") {
    if (files[0]) fs.appendFileSync(files[0], `${pattern} ${key.type} ${key.blob}\n`);
    return;
  }
  fail(
    `No ${key.type.replace("ssh-", "").toUpperCase()} host key is known for ${pattern} and you have requested strict checking.\nHost key verification failed.`,
  );
}

function verifyAuth(parsed) {
  if (hostEntry(parsed.host).auth === "denied") fail(`${parsed.user}@${parsed.host}: Permission denied (publickey).`);
  if (hostEntry(parsed.host).unreachable)
    fail(`ssh: connect to host ${parsed.host} port ${parsed.port}: Connection refused`);
}

function socketIsLive(path) {
  return new Promise((resolve) => {
    const client = net.connect(path);
    client.once("connect", () => {
      client.destroy();
      resolve(true);
    });
    client.once("error", () => resolve(false));
  });
}

function sendControl(path, message) {
  return new Promise((resolve) => {
    const client = net.connect(path);
    let buffer = "";
    client.once("error", (error) => resolve({ ok: false, error: error.message, missing: true }));
    client.on("connect", () => client.write(`${JSON.stringify(message)}\n`));
    client.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      if (buffer.includes("\n")) {
        client.destroy();
        resolve(JSON.parse(buffer.split("\n")[0]));
      }
    });
  });
}

async function runControl(parsed) {
  const socket = parsed.options.get("ControlPath");
  const request = { cmd: parsed.control };
  if (parsed.forward) {
    const [, localPort, , remotePort] = parsed.forward.split(":");
    Object.assign(request, { localPort: Number(localPort), remotePort: Number(remotePort) });
  }
  const reply = await sendControl(socket, request);
  if (reply.missing) fail(`Control socket connect(${socket}): No such file or directory`);
  if (!reply.ok) fail(reply.error);
  if (parsed.control === "check") process.stderr.write(`Master running (pid=${reply.pid})\n`);
  process.exit(0);
}

function startMaster(parsed, host) {
  const socket = parsed.options.get("ControlPath");
  const forwards = new Map();
  const server = net.createServer((client) => {
    let buffer = "";
    client.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      const message = JSON.parse(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      handleControl(message, client);
    });
    client.on("error", () => undefined);
  });
  const reply = (client, body) => client.end(`${JSON.stringify(body)}\n`);
  const handleControl = (message, client) => {
    if (message.cmd === "check") return reply(client, { ok: true, pid: process.pid });
    if (message.cmd === "exit") {
      reply(client, { ok: true });
      return setImmediate(() => process.exit(0));
    }
    if (message.cmd === "cancel") {
      const listener = forwards.get(message.localPort);
      listener?.close();
      forwards.delete(message.localPort);
      return reply(client, { ok: true });
    }
    const listener = net.createServer((incoming) => {
      const current = hostEntry(host);
      if (current.forward === "deny") return incoming.destroy();
      const upstream = net.connect(message.remotePort, "127.0.0.1");
      upstream.on("error", () => incoming.destroy());
      incoming.on("error", () => upstream.destroy());
      incoming.pipe(upstream);
      upstream.pipe(incoming);
    });
    listener.once("error", (error) =>
      reply(client, {
        ok: false,
        error: `bind [127.0.0.1]:${message.localPort}: ${error.code === "EADDRINUSE" ? "Address already in use" : error.message}\nmux_client_forward: forwarding request failed: Port forwarding failed`,
      }),
    );
    listener.listen(message.localPort, "127.0.0.1", () => {
      forwards.set(message.localPort, listener);
      reply(client, { ok: true });
    });
  };
  return new Promise((resolve) => {
    fs.rmSync(socket, { force: true });
    server.once("error", () => resolve(null));
    server.listen(socket, () => resolve(server));
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const parsed = parseArgs(argv);
  if (parsed.control) return runControl(parsed);

  verifyHostKey(parsed);
  verifyAuth(parsed);

  const entry = hostEntry(parsed.host);
  const socket = parsed.options.get("ControlPath");
  let master = null;
  if (socket && parsed.options.get("ControlMaster") !== "no") {
    if (!(await socketIsLive(socket))) master = await startMaster(parsed, parsed.host);
  }
  const cleanup = () => {
    if (master) {
      master.close();
      fs.rmSync(socket, { force: true });
    }
  };

  if (parsed.master) {
    process.on("SIGTERM", () => {
      cleanup();
      process.exit(0);
    });
    const keepAlive = () => setTimeout(keepAlive, 1 << 30);
    keepAlive();
    return;
  }

  const environment = { ...process.env };
  if (entry.home) environment.HOME = entry.home;
  if (entry.python === "missing") environment.PATH = "/nonexistent";
  const child = spawn("/bin/sh", ["-c", parsed.remoteCommand ?? "true"], { stdio: "inherit", env: environment });
  let dropped = false;
  if (entry.dropAfterMs) {
    setTimeout(() => {
      dropped = true;
      child.kill("SIGKILL");
    }, entry.dropAfterMs);
  }
  const forward = (signal) => () => {
    child.kill(signal);
  };
  process.on("SIGTERM", forward("SIGTERM"));
  process.on("SIGHUP", forward("SIGHUP"));
  child.on("exit", (code, signal) => {
    cleanup();
    if (dropped) fail("client_loop: send disconnect: Broken pipe");
    process.exit(code ?? (signal ? 255 : 0));
  });
}

main();
