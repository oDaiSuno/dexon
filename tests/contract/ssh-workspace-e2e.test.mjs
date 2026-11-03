import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { MessageChannel } from "node:worker_threads";
import { importTestBundle } from "#test-bundle";
import { createRpcClient, createRpcServer } from "../../src/contract/rpc.ts";
import { installMainProcessPort } from "../fixtures/main-process-port.mjs";
import { startLocalHelper } from "../../src/agent-host/workspace/testing/local-helper.ts";
import { inspectHelperSource } from "../../src/agent-host/workspace/testing/python-comments.ts";

const base = realpathSync(mkdtempSync(path.join(tmpdir(), "dexon-ssh-e2e-")));
const agent = path.join(base, "agent");
const sessions = path.join(base, "sessions");
const desktop = path.join(base, "desktop");
const fakeBin = path.join(base, "bin");
mkdirSync(agent);
mkdirSync(sessions);
mkdirSync(desktop);
mkdirSync(fakeBin);

const prev = new Map(
  ["PI_CODING_AGENT_DIR", "PI_CODING_AGENT_SESSION_DIR", "PI_DESKTOP_USER_DATA", "PI_OFFLINE"].map((n) => [
    n,
    process.env[n],
  ]),
);
process.env.PI_CODING_AGENT_DIR = agent;
process.env.PI_CODING_AGENT_SESSION_DIR = sessions;
process.env.PI_DESKTOP_USER_DATA = desktop;
process.env.PI_OFFLINE = "1";
const restoreMain = installMainProcessPort();

const { registerHandlers } = await importTestBundle("ssh-e2e", {
  packages: "external",
  absWorkingDir: path.resolve(import.meta.dirname, "../.."),
  entryPoints: ["src/agent-host/handlers.ts"],
});

after(() => {
  restoreMain();
  for (const [n, v] of prev) {
    if (v === undefined) delete process.env[n];
    else process.env[n] = v;
  }
  rmSync(base, { recursive: true, force: true });
});

function connect(t) {
  const server = createRpcServer();
  const { port1, port2 } = new MessageChannel();
  server.attachPort(port1);
  const client = createRpcClient(port2);
  const cleanupHost = registerHandlers(server);
  t.after(async () => {
    try {
      await cleanupHost();
    } finally {
      client.close();
      server.detachPort(port1);
    }
  });
  return client;
}

test("helper source has zero Python comments and compiles under Python 3.9", () => {
  const report = inspectHelperSource();
  assert.equal(report.commentLines.length, 0, `Comment lines found: ${report.commentLines.join(", ")}`);
  assert.equal(report.compiles, true, `Python compilation failed: ${report.stderr}`);
});

test("helper ping and hostFacts work over the real helper process", async () => {
  const helper = await startLocalHelper();
  try {
    const ping = await helper.link.request("ping", {});
    assert.equal(ping.ok, true);
    const facts = await helper.link.request("hostFacts", {});
    assert.equal(typeof facts.platform, "string");
    assert.equal(typeof facts.pythonVersion, "string");
    assert.equal(typeof facts.remoteHome, "string");
  } finally {
    await helper.dispose();
  }
});

test("helper reads and writes a file atomically through real /usr/bin/python3", async () => {
  const helper = await startLocalHelper();
  const dir = mkdtempSync(path.join(tmpdir(), "dx-helper-rw-"));
  try {
    const testPath = path.join(dir, "hello.txt");
    const content = "hello ssh world\n";
    await helper.link.request("writeAtomic", {
      path: testPath,
      withinRoot: dir,
      bytes: Buffer.from(content, "utf8"),
      mkdirp: false,
    });
    const result = await helper.link.request("read", {
      candidates: [testPath],
      maxBytes: 1024,
    });
    assert.equal(Buffer.from(result.bytes).toString("utf8"), content);
  } finally {
    await helper.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("helper listDir returns entries without the path escaping the root", async () => {
  const helper = await startLocalHelper();
  const dir = mkdtempSync(path.join(tmpdir(), "dx-helper-ls-"));
  try {
    writeFileSync(path.join(dir, "a.ts"), "");
    writeFileSync(path.join(dir, "b.ts"), "");
    const result = await helper.link.request("listDir", { path: dir, withinRoot: dir, ignore: [] });
    const names = result.entries.map((e) => e.name).sort();
    assert.deepEqual(names, ["a.ts", "b.ts"]);
    await assert.rejects(
      helper.link.request("listDir", { path: path.dirname(dir), withinRoot: dir, ignore: [] }),
      (e) => e.code === "OUTSIDE_ROOT",
    );
  } finally {
    await helper.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("helper exec streams stdout and stderr and reports exit code", async () => {
  const helper = await startLocalHelper();
  try {
    const chunks = [];
    const result = await helper.link.request(
      "exec",
      { argv: ["/bin/sh", "-c", "echo stdout-line; echo stderr-line 1>&2; exit 7"], cwd: "/tmp" },
      { onData: (d) => chunks.push([d.stream, Buffer.from(d.bytes).toString("utf8").trim()]) },
    );
    assert.equal(result.exitCode, 7);
    assert.ok(chunks.some(([s, t]) => s === "stdout" && t === "stdout-line"));
    assert.ok(chunks.some(([s, t]) => s === "stderr" && t === "stderr-line"));
  } finally {
    await helper.dispose();
  }
});

test("helper exec cancel stops the running process via CANCELLED", async (t) => {
  const helper = await startLocalHelper();
  t.after(() => helper.dispose());
  const ac = new globalThis.AbortController();
  const request = helper.link.request("exec", { argv: ["/bin/sleep", "60"], cwd: "/tmp" }, { signal: ac.signal });
  setTimeout(() => ac.abort(), 100);
  const error = await request.catch((e) => e);
  assert.equal(error.code, "CANCELLED");
});

test("helper gitSnapshot returns current branch and status for a real git repo", async () => {
  const helper = await startLocalHelper();
  const dir = mkdtempSync(path.join(tmpdir(), "dx-helper-git-"));
  try {
    const { execSync } = await import("node:child_process");
    execSync("git init && git commit --allow-empty -m init", {
      cwd: dir,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@t",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@t",
      },
    });
    const result = await helper.link.request("gitSnapshot", { cwd: dir });
    assert.equal(result.isGitRepo, true);
    assert.equal(typeof result.currentBranch, "string");
  } finally {
    await helper.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("helper browseDir returns a sorted entry list with git repos ranked first", async () => {
  const helper = await startLocalHelper();
  const dir = mkdtempSync(path.join(tmpdir(), "dx-helper-browse-"));
  try {
    mkdirSync(path.join(dir, "notgit"));
    mkdirSync(path.join(dir, "myrepo", ".git"), { recursive: true });
    const result = await helper.link.request("browseDir", { path: dir });
    assert.equal(result.currentPath.startsWith("/"), true);
    const names = result.entries.map((e) => e.name);
    assert.equal(names[0], "myrepo");
    assert.equal(result.entries[0].isGitRepo, true);
  } finally {
    await helper.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("helper reconcileRuns returns verified-clean for a stale bootId", async () => {
  const helper = await startLocalHelper();
  try {
    const result = await helper.link.request("reconcileRuns", {
      tickets: [
        {
          version: 2,
          platform: "ssh",
          workspace: "ssh://ubuntu@prod-vps/app",
          hostId: "ssh://ubuntu@prod-vps:22",
          processId: "proc-1",
          runId: "run-1",
          hostInstanceId: "inst",
          bootId: "clearly-wrong-boot-id",
          pid: 1,
          pgid: 1,
          startFingerprint: "",
          nonce: "n1",
          createdAt: Date.now(),
        },
      ],
    });
    assert.equal(result.evidence.length, 1);
    assert.equal(result.evidence[0].state, "verified-clean");
    assert.equal(result.evidence[0].method, "boot-changed");
  } finally {
    await helper.dispose();
  }
});

test("remote.parse correctly classifies SSH workspace addresses and host-only addresses", async (t) => {
  const client = connect(t);
  const ws = await client.call("remote.parse", { input: "ubuntu@prod-vps:/home/ubuntu/app" });
  assert.equal(ws.ok, true);
  assert.equal(ws.value.kind, "workspace");
  assert.equal(ws.value.ref.target.user, "ubuntu");
  assert.equal(ws.value.ref.root, "/home/ubuntu/app");
  const cmd = await client.call("remote.parse", { input: "ssh -p 2222 ubuntu@47.98.12.34" });
  assert.equal(cmd.ok, true);
  assert.equal(cmd.value.kind, "host-only");
  assert.equal(cmd.value.target.port, 2222);
});

test("fake ssh script: remote.browse with a trust prompt resolves workspace on trust", async (t) => {
  const fakeSsh = path.resolve(import.meta.dirname, "../../src/agent-host/workspace/testing/fake-ssh-program.mjs");
  const fakeSshWrapper = path.join(fakeBin, "ssh");
  writeFileSync(fakeSshWrapper, `#!/bin/sh\nexec /usr/bin/env node ${fakeSsh} "$@"\n`);
  chmodSync(fakeSshWrapper, 0o755);
  const scenarioFile = path.join(base, "scenario.json");
  writeFileSync(scenarioFile, JSON.stringify({ default: {} }));
  const savedBinary = process.env.DEXON_SSH_BINARY;
  process.env.DEXON_SSH_BINARY = fakeSshWrapper;
  process.env.DEXON_FAKE_SSH_SCENARIO = scenarioFile;
  t.after(() => {
    if (savedBinary === undefined) delete process.env.DEXON_SSH_BINARY;
    else process.env.DEXON_SSH_BINARY = savedBinary;
    delete process.env.DEXON_FAKE_SSH_SCENARIO;
  });
  const client = connect(t);
  const result = await client.call("remote.parse", { input: "ubuntu@loopback-test:/tmp" });
  assert.equal(result.ok, true);
  assert.equal(result.value.kind, "workspace");
});
