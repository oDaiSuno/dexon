import assert from "node:assert/strict";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { disposeAll, packagedDaemon, task, http, startRun, phase, until, deferred } from "./fixture.mjs";
import { desktop, rendererBridge, rejectRenderer } from "./desktop.mjs";
import { loopback, digest } from "./boundaries.mjs";

export async function authorization() {
  const boundary = await loopback();
  let daemon;
  let ui;
  let renderer;
  let decision;
  const secrets = ['remote-secret-canary-"quote"-\\slash', "remote-template-canary", "unrelated-secret-canary"];
  try {
    daemon = await packagedDaemon("e1");
    const connection = await daemon.connect();
    const rpc = connection.rpc;
    ui = await desktop(daemon, { show: () => decision.promise });
    const command = (type, extra = {}) => ui.authority({ type, environmentId: ui.environmentId, ...extra });
    assert.deepEqual(await command("set-secret", { name: "api.token", value: "old-value-canary" }), { ok: true });
    assert.deepEqual(await command("list-secret-names"), { names: ["api.token"] });
    assert.deepEqual(await command("set-secret", { name: "api.token", value: secrets[0] }), { ok: true });
    await command("set-secret", { name: "template.token", value: secrets[1] });
    await command("set-secret", { name: "unrelated", value: secrets[2] });
    const secretPath = path.join(daemon.stateDir, "automation.secrets.json");
    const channelPath = path.join(daemon.stateDir, "channels.secrets.json");
    assert.equal(statSync(secretPath).mode & 0o777, 0o600);
    assert.notEqual(statSync(secretPath).ino, statSync(channelPath).ino);
    assert.equal(readFileSync(channelPath, "utf8").includes("api.token"), false);
    const scriptPath = path.join(daemon.cwd, "proof.mjs");
    const script = `const names = Object.keys(process.env).filter(name => name.startsWith("DEXON_SECRET_")).sort();
if (JSON.stringify(names) !== JSON.stringify(["DEXON_SECRET_api.token"])) process.exit(78);
const response = await fetch(${JSON.stringify(`${boundary.origin}/script-proof`)}, { method: "POST", headers: { "x-secret": process.env["DEXON_SECRET_api.token"] }, body: JSON.stringify({ names }) });
if (!response.ok) process.exit(78);
console.log(JSON.stringify({ ok: true, names }));\n`;
    writeFileSync(scriptPath, script);
    boundary.handlers.set("/http-proof", (entry, response) => {
      assert.equal(entry.headers["x-secret"], secrets[0]);
      assert.equal(JSON.parse(entry.body).token, secrets[1]);
      response.writeHead(200, { "content-type": "application/json", "x-private-echo": secrets[0] });
      response.end('{"ok":true}');
    });
    boundary.handlers.set("/script-proof", (entry, response) => {
      assert.equal(entry.headers["x-secret"], secrets[0]);
      assert.deepEqual(JSON.parse(entry.body).names, ["DEXON_SECRET_api.token"]);
      response.end("{}");
    });
    const spec = task(daemon.cwd, "secret-delivery", [
      http("publish", boundary.origin, "/http-proof", {
        secretHeaders: { "x-secret": "api.token", "x-template": "template.token" },
        body: { token: { $secret: "template.token" } },
      }),
      {
        id: "script",
        kind: "action",
        call: { action: "script.run", with: { path: "proof.mjs", effect: "unsafe", secrets: ["api.token"] } },
      },
    ]);
    const saved = await rpc.call("automation.saveTask", { spec });
    const enable = () =>
      command("enable-task", { taskId: spec.id, revision: saved.revision, planHash: saved.planHash });
    const restrictedCount = () => ui.audit.filter(({ method }) => method === "automation.enableTask").length;
    decision = deferred();
    const cancelled = enable();
    await until(() => ui.dialogs.length === 1, "cancel dialog opened");
    assert.equal(restrictedCount(), 0);
    assert.equal((await rpc.call("automation.listTasks")).tasks[0].enabledRevision, null);
    decision.resolve({ response: 0 });
    assert.deepEqual(await cancelled, { outcome: "cancelled" });
    assert.equal(restrictedCount(), 0);
    decision = deferred();
    const approved = enable();
    await until(() => ui.dialogs.length === 2, "approval dialog opened");
    assert.equal(restrictedCount(), 0);
    assert.equal((await rpc.call("automation.listTasks")).tasks[0].enabledRevision, null);
    const dialog = ui.dialogs[1];
    assert.equal(dialog.defaultId, 0);
    assert.equal(dialog.cancelId, 0);
    assert.deepEqual(saved.requiredGrant.secrets, ["api.token", "template.token"]);
    for (const value of [
      "Remote A",
      ui.environmentId,
      connection.descriptor.environmentId,
      daemon.cwd,
      boundary.origin,
      "proof.mjs",
      digest(script),
      "api.token",
      "template.token",
      "publish",
      "http_write",
      "script",
      "script_write",
    ])
      assert.ok(dialog.detail.includes(value), value);
    decision.resolve({ response: 1 });
    assert.equal((await approved).outcome, "enabled");
    assert.equal(restrictedCount(), 1);
    assert.equal((await rpc.call("automation.listTasks")).tasks[0].enabledRevision, saved.revision);
    const runId = await startRun(rpc, spec.id);
    await phase(rpc, runId, "succeeded");
    await boundary.wait("/script-proof");
    decision = { promise: Promise.resolve({ response: 1 }) };
    const dynamic = task(daemon.cwd, "dynamic-secret-denied", [
      http("dynamic", boundary.origin, "/must-not-send", { body: { $ref: "input" } }),
    ]);
    await ui.enable(rpc, dynamic);
    const denied = await phase(rpc, await startRun(rpc, dynamic.id, "{{secret:unrelated}}"), "failed");
    assert.ok(JSON.stringify(denied).includes("grant_violation"));
    assert.equal(
      boundary.requests.some(({ url }) => url === "/must-not-send"),
      false,
    );
    boundary.handlers.set("/echo", (entry, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ leaked: entry.headers["x-secret"] }));
    });
    const echo = task(daemon.cwd, "echo-rejected", [
      http("echo", boundary.origin, "/echo", { effect: "unsafe", secretHeaders: { "x-secret": "api.token" } }),
    ]);
    await ui.enable(rpc, echo);
    const attention = await phase(rpc, await startRun(rpc, echo.id), "attention");
    assert.ok(JSON.stringify(attention).includes("invalid_input"));
    await rpc.call("automation.disableTask", { taskId: spec.id });
    const before = await rpc.call("automation.getTask", { taskId: spec.id });
    const namesBefore = await command("list-secret-names");
    const secretBytesBefore = readFileSync(secretPath);
    const channelBytesBefore = readFileSync(channelPath);
    renderer = rendererBridge(connection, daemon.responses);
    const bridge = await rejectRenderer(
      renderer,
      [
        "automation.enableTask",
        "automation.resolveAttention",
        "automation.setSecret",
        "automation.deleteSecret",
        "automation.listSecretNames",
      ],
      {
        "automation.enableTask": { taskId: spec.id, revision: saved.revision, planHash: saved.planHash },
        "automation.resolveAttention": {
          runId: attention.id,
          stepIndex: 0,
          expectedVersion: attention.version,
          requestId: "renderer-bypass",
          resolution: { kind: "attention", action: "mark_succeeded" },
        },
        "automation.setSecret": { name: "api.token", value: "compromised-overwrite" },
        "automation.deleteSecret": { name: "api.token" },
      },
    );
    assert.deepEqual(await rpc.call("automation.getTask", { taskId: spec.id }), before);
    assert.deepEqual(await rpc.call("automation.getRun", { runId: attention.id }), { run: attention });
    assert.deepEqual(await command("list-secret-names"), namesBefore);
    assert.deepEqual(readFileSync(secretPath), secretBytesBefore);
    assert.deepEqual(readFileSync(channelPath), channelBytesBefore);
    await enable();
    await command("delete-secret", { name: "api.token" });
    const requestCount = boundary.requests.length;
    const missing = await phase(rpc, await startRun(rpc, spec.id), "failed");
    assert.ok(JSON.stringify(missing).includes("missing_secret"));
    assert.equal(boundary.requests.length, requestCount);
    const runs = await rpc.call("automation.listRuns", {});
    for (const run of runs.runs) await rpc.call("automation.getRun", { runId: run.id });
    renderer.close();
    renderer = undefined;
    await ui.dispose();
    ui = undefined;
    const shutdown = await daemon.stop();
    const capture = JSON.stringify(daemon.responses) + daemon.log();
    for (const secret of [...secrets, "old-value-canary"]) {
      assert.equal(capture.includes(secret), false, "No raw secret in API, IPC or daemon log");
      assert.equal(
        capture.includes(JSON.stringify(secret).slice(1, -1)),
        false,
        "No escaped secret in API, IPC or daemon log",
      );
    }
    return {
      dialogSnapshot: dialog,
      consent: { cancelledWithoutRemoteMutation: true, pendingEnableRpcCount: 0, approvedEnableRpcCount: 1 },
      secretsMode: "0600",
      separateChannelStore: true,
      expectedSecretHashes: { "api.token": digest(secrets[0]), "template.token": digest(secrets[1]) },
      secretBytesUnchangedAfterBypass: true,
      declaredScriptSecretsOnly: true,
      grantViolation: true,
      missingSecret: true,
      echoRejected: true,
      externalRequests: boundary.safeLog(),
      bridge,
      shutdown,
      plaintextScan: {
        responseFrames: daemon.responses.length,
        daemonLogBytes: Buffer.byteLength(daemon.log()),
        leaksFound: 0,
      },
    };
  } catch (error) {
    if (daemon) console.error(daemon.log());
    throw error;
  } finally {
    decision?.resolve?.({ response: 0 });
    renderer?.close();
    await disposeAll(
      () => ui?.dispose(),
      () => daemon?.dispose(),
      () => boundary.close(),
    );
  }
}
