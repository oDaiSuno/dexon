import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { MessageChannel } from "node:worker_threads";
import { importTestBundle } from "#test-bundle";
import { createDeferred } from "#test-timing";
import { createRpcClient, createRpcServer } from "../../src/contract/rpc.ts";
import { installMainProcessPort } from "../fixtures/main-process-port.mjs";

const base = realpathSync(mkdtempSync(path.join(tmpdir(), "dexon-remote-contract-")));
const agent = path.join(base, "agent");
mkdirSync(agent);
const variables = ["PI_CODING_AGENT_DIR", "PI_CODING_AGENT_SESSION_DIR", "PI_DESKTOP_USER_DATA", "PI_OFFLINE"];
const previous = new Map(variables.map((name) => [name, process.env[name]]));
process.env.PI_CODING_AGENT_DIR = agent;
process.env.PI_CODING_AGENT_SESSION_DIR = path.join(base, "sessions");
process.env.PI_DESKTOP_USER_DATA = path.join(base, "desktop");
process.env.PI_OFFLINE = "1";
const restoreMainProcess = installMainProcessPort();

const { registerHandlers } = await importTestBundle("remote-contract", {
  packages: "external",
  absWorkingDir: path.resolve(import.meta.dirname, "../.."),
  entryPoints: ["src/agent-host/handlers.ts"],
});

after(() => {
  restoreMainProcess();
  for (const [name, value] of previous) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  rmSync(base, { recursive: true, force: true });
});

function connectHost(t) {
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

async function eventsOf(t, client, topic, key = "*") {
  const arrived = [];
  const waiting = [];
  const off = client.subscribe(topic, key, (event) => {
    const waiter = waiting.shift();
    if (waiter) waiter.resolve(event);
    else arrived.push(event);
  });
  t.after(off);
  await client.call("remote.hosts");
  return {
    next() {
      if (arrived.length) return Promise.resolve(arrived.shift());
      const waiter = createDeferred();
      waiting.push(waiter);
      return waiter.promise;
    },
  };
}

const { registerRemoteHandlers } = await importTestBundle("remote-trust-gate", {
  packages: "external",
  absWorkingDir: path.resolve(import.meta.dirname, "../.."),
  entryPoints: ["src/agent-host/handlers/remote.ts"],
});

function connectRemoteGate(t) {
  const server = createRpcServer();
  const { port1, port2 } = new MessageChannel();
  server.attachPort(port1);
  const client = createRpcClient(port2);
  const gate = registerRemoteHandlers(server);
  t.after(() => {
    client.close();
    server.detachPort(port1);
  });
  return { client, gate };
}

const PROD = "ssh://ubuntu@prod-vps/home/ubuntu/app";
const STAGING = "ssh://ubuntu@staging-02/home/ubuntu/app";

test("pasting a terminal login command is understood as a server with its user and port", async (t) => {
  const client = connectHost(t);
  assert.deepEqual(await client.call("remote.parse", { input: "ssh -p 2222 ubuntu@47.98.12.34" }), {
    ok: true,
    value: { kind: "host-only", target: { user: "ubuntu", host: "47.98.12.34", port: 2222 } },
  });
  assert.deepEqual(await client.call("remote.parse", { input: "ubuntu@prod-vps:/home/ubuntu/./app/" }), {
    ok: true,
    value: {
      kind: "workspace",
      ref: { kind: "ssh", target: { user: "ubuntu", host: "prod-vps" }, root: "/home/ubuntu/app" },
    },
  });
});

test("a login command that tries to smuggle in server options is refused with a message", async (t) => {
  const client = connectHost(t);
  const refused = await client.call("remote.parse", { input: "ssh -o ProxyCommand=evil prod-vps" });
  assert.equal(refused.ok, false);
  assert.equal(typeof refused.error, "string");
  assert.ok(refused.error.length > 0);
});

test("a freshly started host knows no remote workspaces", async (t) => {
  const client = connectHost(t);
  assert.deepEqual(await client.call("remote.workspacesSnapshot"), { states: {} });
  assert.deepEqual(await client.call("remote.workspaceState", { workspace: PROD }), { state: null });
  assert.deepEqual(await client.call("remote.hosts"), { hosts: [] });
});

test("trusting a remote workspace is announced once per change and the revision only moves forward", async (t) => {
  const client = connectHost(t);
  const announcements = await eventsOf(t, client, "workspace.state", PROD);

  const trusted = await client.call("remote.trustSet", {
    workspace: "ubuntu@prod-vps:/home/ubuntu/./app/",
    trust: "trusted",
  });
  assert.equal(trusted.state.workspace, PROD);
  assert.equal(trusted.state.hostLabel, "prod-vps");
  assert.equal(trusted.state.authorityLabel, "ubuntu@prod-vps");
  assert.equal(trusted.state.remotePath, "/home/ubuntu/app");
  assert.equal(trusted.state.workspaceTrust, "trusted");
  assert.equal(trusted.state.trustRevision, 1);
  assert.deepEqual(await announcements.next(), { workspace: PROD, state: trusted.state, transition: "trusted" });

  const unchanged = await client.call("remote.trustSet", { workspace: PROD, trust: "trusted" });
  assert.deepEqual(unchanged.state, trusted.state);

  const revoked = await client.call("remote.trustSet", { workspace: PROD, trust: "read-only" });
  assert.equal(revoked.state.workspaceTrust, "read-only");
  assert.equal(revoked.state.trustRevision, 2);
  assert.deepEqual(await announcements.next(), { workspace: PROD, state: revoked.state, transition: "read-only" });

  assert.deepEqual(await client.call("remote.workspaceState", { workspace: PROD }), { state: revoked.state });
  assert.deepEqual(await client.call("remote.workspacesSnapshot"), { states: { [PROD]: revoked.state } });
});

test("two servers that share the same folder path never share trust", async (t) => {
  const client = connectHost(t);
  const production = await client.call("remote.trustSet", { workspace: PROD, trust: "trusted" });
  assert.deepEqual(await client.call("remote.workspaceState", { workspace: STAGING }), { state: null });

  const staging = await client.call("remote.trustSet", { workspace: STAGING, trust: "read-only" });
  assert.equal(staging.state.workspaceTrust, "read-only");
  assert.equal(staging.state.trustRevision, 0);

  const { states } = await client.call("remote.workspacesSnapshot");
  assert.deepEqual(Object.keys(states).sort(), [PROD, STAGING]);
  assert.equal(states[PROD].workspaceTrust, "trusted");
  assert.deepEqual(states[PROD], production.state);
  assert.equal(states[STAGING].workspaceTrust, "read-only");
});

test("only remote workspaces can be trusted and unusable requests are rejected as bad requests", async (t) => {
  const client = connectHost(t);
  for (const params of [
    { workspace: "/Users/me/project", trust: "trusted" },
    { workspace: "C:\\Projects\\App", trust: "trusted" },
    { workspace: "not an address", trust: "trusted" },
    { workspace: PROD, trust: "everything" },
    { workspace: PROD },
  ]) {
    await assert.rejects(
      client.call("remote.trustSet", params),
      (error) => error.code === "BAD_REQUEST" && typeof error.message === "string",
      JSON.stringify(params),
    );
  }
  assert.deepEqual(await client.call("remote.workspacesSnapshot"), { states: {} });
});

test("a command waiting for trust continues only after the user decides, and the decision is remembered", async (t) => {
  const { client, gate } = connectRemoteGate(t);
  const prompts = await eventsOf(t, client, "workspace.trustPrompt", PROD);
  const request = {
    workspace: "ubuntu@prod-vps:/home/ubuntu/app",
    sessionId: "session-1",
    kind: "process_start",
    command: "pnpm dev --host 127.0.0.1 --port 3000",
    cwd: "/home/ubuntu/app",
    remoteHostLabel: "prod-vps",
    remoteSkillCount: 2,
  };

  let decided;
  const waiting = gate.openTrustPrompt(request).then((trust) => (decided = trust));
  const pending = await prompts.next();
  assert.equal(pending.status, "pending");
  assert.equal(pending.workspace, PROD);
  assert.equal(pending.command, request.command);
  assert.equal(pending.remoteSkillCount, 2);
  assert.equal(typeof pending.promptId, "string");
  assert.equal(decided, undefined);

  const answer = await client.call("remote.trustPromptResolve", { promptId: pending.promptId, decision: "trust" });
  assert.equal(await waiting, "trusted");
  assert.equal(answer.state.workspaceTrust, "trusted");
  assert.deepEqual(await prompts.next(), { ...pending, status: "resolved" });
  assert.deepEqual(await client.call("remote.workspaceState", { workspace: PROD }), { state: answer.state });

  await assert.rejects(
    client.call("remote.trustPromptResolve", { promptId: pending.promptId, decision: "trust" }),
    (error) => error.code === "NOT_FOUND",
  );
});

test("refusing a trust prompt keeps the workspace read-only and releases the waiting command", async (t) => {
  const { client, gate } = connectRemoteGate(t);
  const prompts = await eventsOf(t, client, "workspace.trustPrompt", STAGING);
  const waiting = gate.openTrustPrompt({
    workspace: STAGING,
    kind: "remote_skill",
    skillName: "deploy",
    cwd: "/home/ubuntu/app",
    remoteHostLabel: "staging-02",
    remoteSkillCount: 1,
  });
  const pending = await prompts.next();
  assert.equal(pending.skillName, "deploy");

  const answer = await client.call("remote.trustPromptResolve", {
    promptId: pending.promptId,
    decision: "keep-read-only",
  });
  assert.equal(await waiting, "read-only");
  assert.equal(answer.state.workspaceTrust, "read-only");
  assert.equal(answer.state.trustRevision, 0);
});
