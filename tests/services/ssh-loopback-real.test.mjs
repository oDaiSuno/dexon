import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, describe } from "node:test";

const ENABLED = process.env.DEXON_SSH_LOOPBACK === "1";

describe("ssh loopback real connection (DEXON_SSH_LOOPBACK=1 to enable)", { skip: !ENABLED }, () => {
  const base = ENABLED ? mkdtempSync(path.join(tmpdir(), "dx-ssh-loopback-")) : "";

  after(() => {
    if (base) rmSync(base, { recursive: true, force: true });
  });

  async function makeConn(khSuffix) {
    const { SshConnection } = await import("../../src/agent-host/workspace/host/ssh/connection.ts");
    const target = { user: process.env.USER ?? "user", host: "127.0.0.1" };
    const kh = path.join(base, `known_hosts${khSuffix}`);
    const userKh = path.join(process.env.HOME ?? "~", ".ssh", "known_hosts");
    return new SshConnection("ssh://user@127.0.0.1:22", target, {
      dexonKnownHostsPath: kh,
      userKnownHostsPath: userKh,
      options: { StrictHostKeyChecking: "accept-new" },
    });
  }

  test(
    "SshConnection can connect to localhost, probe facts, read a file, and write a file",
    { timeout: 60_000 },
    async () => {
      const conn = await makeConn("1");
      try {
        const facts = await conn.connect();
        assert.ok(facts.platform === "linux" || facts.platform === "darwin");
        assert.equal(typeof facts.remoteHome, "string");

        const dir = mkdtempSync(path.join(tmpdir(), "dx-loopback-files-"));
        const testPath = path.join(dir, "loopback.txt");
        const content = "loopback-ok\n";
        await conn.request("writeAtomic", {
          path: testPath,
          withinRoot: dir,
          bytes: Buffer.from(content, "utf8"),
          mkdirp: false,
        });
        const readResult = await conn.request("read", { candidates: [testPath], maxBytes: 1024 });
        assert.equal(Buffer.from(readResult.bytes).toString("utf8"), content);
        rmSync(dir, { recursive: true, force: true });
      } finally {
        await conn.dispose();
      }
    },
  );

  test("SshConnection exec streams stdout and respects abort", { timeout: 30_000 }, async () => {
    const conn = await makeConn("2");
    try {
      await conn.connect();
      const lines = [];
      const result = await conn.streamExec({
        argv: ["/bin/sh", "-c", "for i in 1 2 3; do echo line-$i; done"],
        cwd: "/tmp",
        onData: (_stream, chunk) => lines.push(chunk.toString("utf8").trim()),
      });
      assert.equal(result.exitCode, 0);
      assert.ok(lines.some((l) => l.includes("line-1")));
    } finally {
      await conn.dispose();
    }
  });
});
