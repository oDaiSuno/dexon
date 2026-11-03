import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

const ENABLED = process.env.DEXON_SSH_LOOPBACK === "1";
const SSH_KEYGEN = "/usr/bin/ssh-keygen";
const SSHD = "/usr/sbin/sshd";

function freeLocalPort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function accepts(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

async function waitUntilListening(port, daemon, getLog) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (daemon.exitCode !== null) throw new Error(`sshd exited early (${daemon.exitCode}): ${getLog()}`);
    if (await accepts(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`sshd did not listen on ${port}: ${getLog()}`);
}

function generateKey(file) {
  const result = spawnSync(SSH_KEYGEN, ["-q", "-t", "ed25519", "-N", "", "-C", "dexon-loopback", "-f", file]);
  assert.equal(result.status, 0, String(result.stderr));
}

describe("ssh loopback real connection (DEXON_SSH_LOOPBACK=1 to enable)", { skip: !ENABLED }, () => {
  let base = "";
  let daemon = null;
  let port = 0;
  let knownHosts = "";
  let identityFile = "";
  let daemonLog = "";

  before(async () => {
    base = realpathSync(mkdtempSync(path.join(tmpdir(), "dx-sshd-")));
    chmodSync(base, 0o700);
    const hostKey = path.join(base, "ssh_host_ed25519_key");
    identityFile = path.join(base, "client_ed25519");
    generateKey(hostKey);
    generateKey(identityFile);
    const authorizedKeys = path.join(base, "authorized_keys");
    writeFileSync(authorizedKeys, readFileSync(`${identityFile}.pub`, "utf8"), { mode: 0o600 });
    port = await freeLocalPort();
    const [hostKeyType, hostKeyBlob] = readFileSync(`${hostKey}.pub`, "utf8").trim().split(/\s+/);
    knownHosts = path.join(base, "known_hosts");
    writeFileSync(knownHosts, `[127.0.0.1]:${port} ${hostKeyType} ${hostKeyBlob}\n`, { mode: 0o600 });
    const config = path.join(base, "sshd_config");
    writeFileSync(
      config,
      [
        `Port ${port}`,
        "ListenAddress 127.0.0.1",
        `HostKey ${hostKey}`,
        `AuthorizedKeysFile ${authorizedKeys}`,
        `PidFile ${path.join(base, "sshd.pid")}`,
        "PasswordAuthentication no",
        "KbdInteractiveAuthentication no",
        "PubkeyAuthentication yes",
        "StrictModes no",
        "UsePAM no",
        "AllowTcpForwarding yes",
        "Subsystem sftp internal-sftp",
        "",
      ].join("\n"),
    );
    daemon = spawn(SSHD, ["-D", "-e", "-f", config], { stdio: ["ignore", "ignore", "pipe"] });
    daemon.stderr.on("data", (chunk) => {
      daemonLog = `${daemonLog}${chunk}`.slice(-4096);
    });
    await waitUntilListening(port, daemon, () => daemonLog);
  });

  after(async () => {
    if (daemon && daemon.exitCode === null) {
      const exited = new Promise((resolve) => daemon.once("exit", resolve));
      daemon.kill("SIGTERM");
      await exited;
    }
    if (base) rmSync(base, { recursive: true, force: true });
  });

  async function connectTo(t) {
    const { SshConnection } = await import("../../src/agent-host/workspace/host/ssh/connection.ts");
    const user = process.env.USER ?? path.basename(homedir());
    const conn = new SshConnection(
      `ssh://${user}@127.0.0.1:${port}`,
      { user, host: "127.0.0.1", port },
      {
        dexonKnownHostsPath: knownHosts,
        userKnownHostsPath: path.join(base, "user_known_hosts"),
        options: { IdentityFile: identityFile, IdentitiesOnly: "yes", IdentityAgent: "none" },
      },
    );
    t.after(() => conn.dispose());
    return conn;
  }

  test("connecting over a real ssh to a real sshd reports the remote machine facts", { timeout: 60_000 }, async (t) => {
    const conn = await connectTo(t);
    const facts = await conn.connect();
    assert.ok(facts.platform === "linux" || facts.platform === "darwin");
    assert.equal(facts.remoteHome, realpathSync(homedir()));
    assert.ok(typeof facts.bootId === "string" && facts.bootId.length > 0);
    assert.equal(conn.connectionState().state, "connected");
  });

  test("a file written atomically through the connection reads back byte for byte", { timeout: 60_000 }, async (t) => {
    const conn = await connectTo(t);
    await conn.connect();
    const dir = mkdtempSync(path.join(base, "files-"));
    const file = path.join(dir, "loopback.txt");
    const content = "loopback-ok\n";
    await conn.request("writeAtomic", {
      path: file,
      withinRoot: dir,
      bytes: Buffer.from(content, "utf8"),
      mkdirp: false,
    });
    assert.equal(readFileSync(file, "utf8"), content);
    const result = await conn.request("read", { candidates: [file], maxBytes: 1024 });
    assert.equal(Buffer.from(result.bytes).toString("utf8"), content);
    assert.ok(existsSync(file));
  });

  test("a remote command streams its output and exits cleanly", { timeout: 60_000 }, async (t) => {
    const conn = await connectTo(t);
    await conn.connect();
    const lines = [];
    const outcome = await conn.streamExec({
      argv: ["/bin/sh", "-c", "for i in 1 2 3; do echo line-$i; done"],
      cwd: "/tmp",
      onData: (_stream, chunk) => lines.push(...chunk.toString("utf8").split("\n").filter(Boolean)),
    });
    assert.equal(outcome.exitCode, 0);
    assert.deepEqual(lines, ["line-1", "line-2", "line-3"]);
  });
});
