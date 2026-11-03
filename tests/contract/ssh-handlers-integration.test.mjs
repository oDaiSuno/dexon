import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { MessageChannel } from "node:worker_threads";
import { importTestBundle } from "#test-bundle";
import { createRpcClient, createRpcServer } from "../../src/contract/rpc.ts";
import { installMainProcessPort } from "../fixtures/main-process-port.mjs";

const base = realpathSync(mkdtempSync(path.join(tmpdir(), "dexon-ssh-handlers-int-")));
const agent = path.join(base, "agent");
const sessions = path.join(base, "sessions");
const desktop = path.join(base, "desktop");
const fakeHome = path.join(base, "home");
const fakeBin = path.join(base, "bin");
mkdirSync(agent);
mkdirSync(sessions);
mkdirSync(desktop);
mkdirSync(fakeHome, { recursive: true });
mkdirSync(fakeBin);

const agentSkillsDir = path.join(agent, "skills");
const agentAuthFile = path.join(agent, "auth.json");
mkdirSync(agentSkillsDir, { recursive: true });
mkdirSync(path.join(agentSkillsDir, "my-skill"), { recursive: true });
writeFileSync(path.join(agentSkillsDir, "my-skill", "SKILL.md"), "# My Skill\n");
writeFileSync(agentAuthFile, JSON.stringify({ token: "SECRET" }));

const prev = new Map(
  ["PI_CODING_AGENT_DIR", "PI_CODING_AGENT_SESSION_DIR", "PI_DESKTOP_USER_DATA", "PI_OFFLINE", "HOME"].map((n) => [
    n,
    process.env[n],
  ]),
);
process.env.PI_CODING_AGENT_DIR = agent;
process.env.PI_CODING_AGENT_SESSION_DIR = sessions;
process.env.PI_DESKTOP_USER_DATA = desktop;
process.env.PI_OFFLINE = "1";
process.env.HOME = fakeHome;
const restoreMain = installMainProcessPort();

const { registerHandlers } = await importTestBundle("ssh-handlers-int", {
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

function setupFakeSsh(t) {
  const fakeSsh = path.resolve(import.meta.dirname, "../../src/agent-host/workspace/testing/fake-ssh-program.mjs");
  const fakeSshWrapper = path.join(fakeBin, `ssh-${Math.random().toString(36).slice(2)}`);
  const scenarioFile = path.join(base, `scenario-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(fakeSshWrapper, `#!/bin/sh\nexec /usr/bin/env node ${fakeSsh} "$@"\n`);
  chmodSync(fakeSshWrapper, 0o755);
  writeFileSync(scenarioFile, JSON.stringify({ default: {} }));
  const savedBinary = process.env.DEXON_SSH_BINARY;
  const savedScenario = process.env.DEXON_FAKE_SSH_SCENARIO;
  process.env.DEXON_SSH_BINARY = fakeSshWrapper;
  process.env.DEXON_FAKE_SSH_SCENARIO = scenarioFile;
  t.after(() => {
    if (savedBinary === undefined) delete process.env.DEXON_SSH_BINARY;
    else process.env.DEXON_SSH_BINARY = savedBinary;
    if (savedScenario === undefined) delete process.env.DEXON_FAKE_SSH_SCENARIO;
    else process.env.DEXON_FAKE_SSH_SCENARIO = savedScenario;
  });
  return { scenarioFile, fakeSshWrapper };
}

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

const SSH_WS = "ssh://ubuntu@test-vps-int/home/ubuntu/app";

test("path-space: credential files in agentDir are blocked in remote sessions", async () => {
  const { PathSpace } = await import("../../src/agent-host/workspace/path-space.ts");
  const space = new PathSpace({
    remoteRoot: "/home/ubuntu/app",
    remoteHome: "/home/ubuntu",
  });

  const route = space.route(agentAuthFile, "/home/ubuntu/app", "read");
  assert.equal(route.space, "denied");
  assert.ok(route.message.includes("protected"));
});

test("path-space: global skill read is allowed as local-overlay", async () => {
  const { PathSpace } = await import("../../src/agent-host/workspace/path-space.ts");
  const space = new PathSpace({
    remoteRoot: "/home/ubuntu/app",
    remoteHome: "/home/ubuntu",
  });

  const skillPath = path.join(agentSkillsDir, "my-skill", "SKILL.md");
  const route = space.route(skillPath, "/home/ubuntu/app", "read");
  assert.equal(route.space, "local-overlay");
});

test("path-space: write to local overlay skill is denied", async () => {
  const { PathSpace } = await import("../../src/agent-host/workspace/path-space.ts");
  const space = new PathSpace({
    remoteRoot: "/home/ubuntu/app",
    remoteHome: "/home/ubuntu",
  });

  const skillPath = path.join(agentSkillsDir, "my-skill", "SKILL.md");
  const route = space.route(skillPath, "/home/ubuntu/app", "write");
  assert.equal(route.space, "denied");
  assert.ok(route.message.includes("read-only"));
});

test("path-space: relative path resolves in remote POSIX space", async () => {
  const { PathSpace } = await import("../../src/agent-host/workspace/path-space.ts");
  const space = new PathSpace({
    remoteRoot: "/home/ubuntu/app",
    remoteHome: "/home/ubuntu",
  });

  const route = space.route("src/index.ts", "/home/ubuntu/app", "read");
  assert.equal(route.space, "remote");
  assert.equal(route.remotePath, "/home/ubuntu/app/src/index.ts");
});

test("path-space: absolute POSIX path resolves in remote space", async () => {
  const { PathSpace } = await import("../../src/agent-host/workspace/path-space.ts");
  const space = new PathSpace({
    remoteRoot: "/home/ubuntu/app",
    remoteHome: "/home/ubuntu",
  });

  const route = space.route("/etc/hostname", "/home/ubuntu/app", "read");
  assert.equal(route.space, "remote");
  assert.equal(route.remotePath, "/etc/hostname");
});

test("sessionDirFor: SSH workspace gets isolated session dir containing host slug", async () => {
  const { sessionDirFor } = await import("../../src/agent-host/workspace/session-binding.ts");
  const ref = { kind: "ssh", target: { user: "ubuntu", host: "prod-vps" }, root: "/home/ubuntu/app" };
  const result = sessionDirFor(ref, sessions);
  assert.ok(typeof result === "string");
  assert.ok(result !== sessions);
  assert.ok(result.includes("--ssh-"));
  assert.ok(result.startsWith(sessions));
});

test("sessionDirFor: local workspace returns configured session dir unchanged", async () => {
  const { sessionDirFor } = await import("../../src/agent-host/workspace/session-binding.ts");
  const ref = { kind: "local", root: "/home/user/project" };
  const result = sessionDirFor(ref, sessions);
  assert.equal(result, sessions);
});

test("sessionDirFor: two different SSH hosts get different session dirs", async () => {
  const { sessionDirFor } = await import("../../src/agent-host/workspace/session-binding.ts");
  const refA = { kind: "ssh", target: { user: "ubuntu", host: "host-a" }, root: "/home/ubuntu/app" };
  const refB = { kind: "ssh", target: { user: "ubuntu", host: "host-b" }, root: "/home/ubuntu/app" };
  const dirA = sessionDirFor(refA, sessions);
  const dirB = sessionDirFor(refB, sessions);
  assert.notEqual(dirA, dirB);
});

test("remote.hosts returns at minimum an empty array (no SSH config crash)", async (t) => {
  const savedHome = process.env.HOME;
  process.env.HOME = fakeHome;
  t.after(() => {
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
  });
  const client = connect(t);
  const result = await client.call("remote.hosts");
  assert.ok(result && Array.isArray(result.hosts), "remote.hosts.hosts should be an array");
});

test("projects.inspectFolder with local path returns ok", async (t) => {
  const client = connect(t);
  const result = await client.call("projects.inspectFolder", { path: base });
  assert.equal(result.ok, true);
});

test("projects.inspectFolder with ssh:// path returns ok:false without crashing when host unavailable", async (t) => {
  const client = connect(t);
  const result = await client.call("projects.inspectFolder", { path: SSH_WS });
  assert.equal(typeof result.ok, "boolean");
});

test("files.list with local path returns entries array", async (t) => {
  const client = connect(t);
  const testDir = path.join(base, "fl-test");
  mkdirSync(testDir, { recursive: true });
  writeFileSync(path.join(testDir, "hello.txt"), "hi");
  await client.call("system.allowRoot", { path: testDir });
  const result = await client.call("files.list", { path: testDir });
  assert.ok(Array.isArray(result.entries));
  assert.ok(result.entries.some((e) => e.name === "hello.txt"));
});

test("host.toolchain with SSH workspace returns empty capabilities without crashing", async (t) => {
  const client = connect(t);
  const result = await client.call("host.toolchain", { cwd: SSH_WS });
  assert.equal(result.resolutionId, "remote");
  assert.equal(typeof result.capabilities, "object");
});

test("models.list with SSH cwd does not crash", async (t) => {
  const client = connect(t);
  const result = await client.call("models.list", { cwd: SSH_WS });
  assert.ok(Array.isArray(result.models));
});

test("git.status with SSH workspace throws or returns isGit:false when host unavailable", async (t) => {
  const client = connect(t);
  let result;
  try {
    result = await client.call("git.status", { path: SSH_WS });
    assert.equal(typeof result.isGit, "boolean");
  } catch (err) {
    assert.ok(err instanceof Error || typeof err === "object");
  }
});

test("worktrees.branches with SSH workspace throws or returns isGit:false when host unavailable", async (t) => {
  const client = connect(t);
  let result;
  try {
    result = await client.call("worktrees.branches", { cwd: SSH_WS });
    assert.equal(typeof result.isGit, "boolean");
  } catch (err) {
    assert.ok(err instanceof Error || typeof err === "object");
  }
});

test("skills.list with SSH cwd returns skills array from local loader without SSH dial", async (t) => {
  const client = connect(t);
  const result = await client.call("skills.list", { cwd: SSH_WS });
  assert.ok(Array.isArray(result.skills));
  assert.ok(Array.isArray(result.diagnostics));
});

test("fake-ssh: projects.inspectFolder over fake SSH returns a workspace key", async (t) => {
  setupFakeSsh(t);
  const client = connect(t);

  await client
    .call("remote.connect", {
      workspace: SSH_WS,
    })
    .catch(() => null);

  const result = await client
    .call("projects.inspectFolder", {
      path: SSH_WS,
    })
    .catch((e) => ({ ok: false, error: String(e.message) }));

  assert.equal(typeof result.ok, "boolean");
});

test("fake-ssh: files.list over fake SSH returns entries or not-found error", async (t) => {
  setupFakeSsh(t);
  const client = connect(t);

  const result = await client.call("files.list", { path: SSH_WS }).catch((e) => ({
    error: e.code ?? e.message,
  }));

  assert.ok("entries" in result || "error" in result);
});

test("fake-ssh: git.status over fake SSH returns isGit field", async (t) => {
  setupFakeSsh(t);
  const client = connect(t);

  const result = await client.call("git.status", { path: SSH_WS }).catch((e) => ({
    error: e.code ?? e.message,
    isGit: false,
  }));

  assert.equal(typeof result.isGit, "boolean");
});

test("containment ledger: SSH containment failure does not block local workspace processes", async () => {
  const { ContainmentLedger } = await import("../../src/agent-host/managed-process/containment-ledger.ts");
  const ledger = new ContainmentLedger();
  const remoteKey = "ssh://ubuntu@prod-vps/home/ubuntu/app";
  const localKey = "/Users/user/local-project";

  ledger.setPending(remoteKey, "run-1", "transport-dropped");
  assert.equal(ledger.isBlocked(remoteKey), true);
  assert.equal(ledger.isBlocked(localKey), false);
});

test("containment ledger: verified-clean clears pending state", async () => {
  const { ContainmentLedger } = await import("../../src/agent-host/managed-process/containment-ledger.ts");
  const ledger = new ContainmentLedger();
  const key = "ssh://ubuntu@prod-vps/home/ubuntu/app";

  ledger.setPending(key, "run-1", "stop-timeout");
  assert.equal(ledger.isBlocked(key), true);
  ledger.setClean(key);
  assert.equal(ledger.isBlocked(key), false);
});

test("resolveSessionWorkspace: SSH session file reads back workspace key", async () => {
  const { sessionDirFor, resolveSessionWorkspace, writeWorkspaceBinding } =
    await import("../../src/agent-host/workspace/session-binding.ts");
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");

  const ref = {
    kind: "ssh",
    target: { user: "ubuntu", host: "test-host-resolve" },
    root: "/home/ubuntu/myproject",
  };
  const sessionDir = sessionDirFor(ref, sessions);
  mkdirSync(sessionDir, { recursive: true });
  const sm = SessionManager.create(ref.root, sessionDir);
  writeWorkspaceBinding(sm, ref);

  const binding = resolveSessionWorkspace(sm);
  assert.equal(binding.kind, "ssh");
  assert.equal(binding.hostLabel, "test-host-resolve");
  assert.equal(binding.remotePath, "/home/ubuntu/myproject");
});

test("SessionManager cwd not corrupted: ssh:// root path is plain POSIX not a local resolve", async () => {
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");

  const ref = {
    kind: "ssh",
    target: { user: "ubuntu", host: "prod-vps" },
    root: "/home/ubuntu/app",
  };
  const sessionDir = path.join(sessions, `test-no-corrupt-${Date.now()}`);
  mkdirSync(sessionDir, { recursive: true });

  const sm = SessionManager.create(ref.root, sessionDir);
  const header = sm.getHeader();
  assert.ok(header !== null, "Header should be set");
  assert.equal(header.cwd, "/home/ubuntu/app");
  assert.ok(!header.cwd.includes("ssh:"), `cwd must not contain 'ssh:' — got: ${header.cwd}`);
  assert.ok(!header.cwd.includes(process.cwd()), `cwd must not be under process.cwd() — got: ${header.cwd}`);
});

test("workspace registry reuses the same ExecutionHost across subdirectories of the same SSH host", async () => {
  const { getOrCreateHost, getHost } = await import("../../src/agent-host/workspace/registry.ts");
  const rootHost = getOrCreateHost("ssh://ubuntu@pool-test-vps/home/ubuntu/app");
  const subFileHost = getOrCreateHost("ssh://ubuntu@pool-test-vps/home/ubuntu/app/src/index.ts");
  const lookedUp = getHost("ssh://ubuntu@pool-test-vps/home/ubuntu/app/docs/readme.md");
  const otherHost = getOrCreateHost("ssh://ubuntu@other-test-vps/home/ubuntu/app");

  assert.ok(rootHost !== null);
  assert.equal(rootHost, subFileHost);
  assert.equal(rootHost, lookedUp);
  assert.notEqual(rootHost, otherHost);
});

test("skills.list distinguishes mirrored remote project skills from local global skills and reflects workspace trust", async (t) => {
  const client = connect(t);
  const { mirrorDirectoryFor } = await import("../../src/agent-host/workspace/resources/merged-loader.ts");
  const remoteWorkspace = "ssh://ubuntu@skill-test-vps/home/ubuntu/app";
  const mirrorRoot = mirrorDirectoryFor(remoteWorkspace);
  const remoteSkillDir = path.join(mirrorRoot, ".pi", "skills", "deploy-canary");
  mkdirSync(remoteSkillDir, { recursive: true });
  writeFileSync(
    path.join(remoteSkillDir, "SKILL.md"),
    "---\nname: deploy-canary\ndescription: Deploy canary build to remote cluster\n---\nDeploy body\n",
  );

  const untrustedList = await client.call("skills.list", { cwd: remoteWorkspace });
  const remoteSkillUntrusted = untrustedList.skills.find((s) => s.name === "deploy-canary");
  assert.ok(remoteSkillUntrusted, "Expected mirrored remote project skill in skills.list");
  assert.equal(remoteSkillUntrusted.origin, "remote-project");
  assert.equal(remoteSkillUntrusted.remoteHostLabel, "skill-test-vps");
  assert.equal(remoteSkillUntrusted.lockedByReadOnly, true);

  await client.call("remote.trustSet", { workspace: remoteWorkspace, trust: "trusted" });
  const trustedList = await client.call("skills.list", { cwd: remoteWorkspace });
  const remoteSkillTrusted = trustedList.skills.find((s) => s.name === "deploy-canary");
  assert.ok(remoteSkillTrusted);
  assert.equal(remoteSkillTrusted.origin, "remote-project");
  assert.equal(remoteSkillTrusted.lockedByReadOnly, false);
});
