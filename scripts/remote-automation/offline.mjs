import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { disposeAll, packagedDaemon, task, http, approval, startRun, phase, until } from "./fixture.mjs";
import { desktop } from "./desktop.mjs";
import { loopback, configureModel, configureWeixin } from "./boundaries.mjs";

export async function offline() {
  const boundary = await loopback();
  let daemon;
  let ui;
  let unsubscribe;
  let model;
  const offlineGate = boundary.hold("/offline-gate");
  try {
    daemon = await packagedDaemon("e2", (fixture) => {
      model = configureModel(fixture, boundary);
      configureWeixin(fixture, boundary);
    });
    const initial = await daemon.connect();
    ui = await desktop(daemon);
    const scheduled = (id) =>
      [
        { id: "manual", kind: "manual" },
        { id: "clock", kind: "schedule", every: "2s" },
      ].map((trigger) => ({ ...trigger, ...(trigger.kind === "schedule" ? { input: { task: id } } : {}) }));
    const gate = () =>
      http("offline-gate", boundary.origin, "/offline-gate", { method: "GET", body: null, effect: "read" });
    const pending = task(
      daemon.cwd,
      "offline-approval",
      [
        gate(),
        {
          kind: "agent",
          id: "agent",
          prompt: "Write offline-proof.txt using the approved workspace write tool, then submit automation_result.",
          tools: ["write"],
          effect: "unsafe",
          model,
          output: {
            schema: {
              type: "object",
              properties: { proved: { const: true } },
              required: ["proved"],
              additionalProperties: false,
            },
          },
        },
        http("notification", boundary.origin, "/offline-http", { body: { runId: { $ref: "run.id" } } }),
        {
          kind: "action",
          id: "channel",
          call: {
            action: "channel.send",
            with: { to: { accountId: "loopback-weixin", peerId: "peer-proof" }, text: "Offline channel proof" },
          },
        },
        approval("human"),
        http("resume", boundary.origin, "/resumed"),
      ],
      { triggers: scheduled("approval"), concurrency: { lane: { capacity: 1, overflow: "skip" } } },
    );
    const timeout = task(
      daemon.cwd,
      "offline-timeout",
      [
        gate(),
        approval("short", { expiresIn: "0.2s", onTimeout: "continue" }),
        http("expired", boundary.origin, "/timeout-ended", { body: { runId: { $ref: "run.id" } } }),
      ],
      { triggers: scheduled("timeout"), concurrency: { lane: { capacity: 1, overflow: "skip" } } },
    );
    await ui.enable(initial.rpc, pending);
    await ui.enable(initial.rpc, timeout);
    await ui.disconnect();
    initial.close();
    const disconnectedAtMs = Date.now();
    offlineGate.release();
    const callsAtDisconnect = daemon.calls.length;
    const authorityCallsAtDisconnect = ui.audit.length;
    const modelCall = await boundary.wait("/v1/chat/completions");
    const httpCall = await boundary.wait("/offline-http");
    const channelCall = await boundary.wait("/ilink/bot/sendmessage");
    const timedOut = await boundary.wait("/timeout-ended");
    await until(
      () => boundary.requests.filter(({ url }) => url === "/timeout-ended").length >= 2,
      "a subsequent scheduled timeout run proves the previous lane completed offline",
    );
    await until(() => existsSync(path.join(daemon.cwd, "offline-proof.txt")), "real offline workspace tool write");
    assert.equal(
      readFileSync(path.join(daemon.cwd, "offline-proof.txt"), "utf8"),
      "Real isolated automation workspace write\n",
    );
    assert.equal(daemon.calls.length, callsAtDisconnect);
    assert.equal(ui.audit.length, authorityCallsAtDisconnect);
    assert.equal(
      boundary.requests.some(({ url }) => url === "/resumed"),
      false,
    );
    for (const entry of [modelCall, httpCall, channelCall, timedOut]) assert.ok(entry.atMs >= disconnectedAtMs);
    const reconnectedAtMs = Date.now();
    const connection = await daemon.connect();
    const events = [];
    const recoveryOrder = [];
    unsubscribe = connection.rpc.subscribe("automation.changed", "*", (event) =>
      events.push({ ...event, atMs: Date.now() }),
    );
    recoveryOrder.push("subscribe:automation.changed");
    const tasks = await connection.rpc.call("automation.listTasks");
    recoveryOrder.push("automation.listTasks");
    const runs = await connection.rpc.call("automation.listRuns", {});
    recoveryOrder.push("automation.listRuns");
    const inbox = await connection.rpc.call("automation.listInbox");
    recoveryOrder.push("automation.listInbox");
    assert.equal(tasks.tasks.length, 2);
    const offlineRunIds = [
      ...new Set(
        boundary.requests
          .filter(({ url, atMs }) => ["/offline-http", "/timeout-ended"].includes(url) && atMs <= reconnectedAtMs)
          .map(({ body }) => JSON.parse(body).runId),
      ),
    ];
    for (const runId of offlineRunIds)
      assert.ok(
        runs.runs.some((run) => run.id === runId),
        `Offline run ${runId} recovered`,
      );
    const waiting = runs.runs.find((run) => run.taskId === pending.id && run.phase === "waiting");
    assert.ok(waiting, JSON.stringify(runs));
    const expired = runs.runs.find((run) => run.id === JSON.parse(timedOut.body).runId && run.phase === "succeeded");
    assert.ok(expired, JSON.stringify(runs));
    assert.ok(expired.endedAtMs <= reconnectedAtMs);
    const item = inbox.items.find((item) => item.runId === waiting.id && item.kind === "approval");
    assert.ok(item);
    assert.ok(item.openedAtMs >= disconnectedAtMs && item.openedAtMs <= reconnectedAtMs);
    for (const spec of [pending, timeout]) await connection.rpc.call("automation.disableTask", { taskId: spec.id });
    const resolved = await connection.rpc.call("automation.resolveInbox", {
      runId: item.runId,
      stepIndex: item.stepIndex,
      expectedVersion: item.expectedVersion,
      requestId: randomUUID(),
      resolution: { kind: "approval", approved: true },
    });
    assert.equal(resolved.ok, true);
    await phase(connection.rpc, waiting.id, "succeeded");
    const resumed = await boundary.wait("/resumed");
    assert.ok(resumed.atMs >= reconnectedAtMs);
    const liveSpec = task(daemon.cwd, "live-after-reconnect", [http("live", boundary.origin, "/live-after-reconnect")]);
    await ui.connect();
    await ui.enable(connection.rpc, liveSpec);
    const liveRun = await startRun(connection.rpc, liveSpec.id);
    const liveEvent = await until(
      () => events.find((event) => event.runIds.includes(liveRun)),
      "live automation.changed after reconnect",
    );
    await phase(connection.rpc, liveRun, "succeeded");
    assert.ok(boundary.requests.filter(({ url }) => url === "/v1/chat/completions").length >= 2);
    const timedOutRun = (await connection.rpc.call("automation.getRun", { runId: expired.id })).run;
    assert.ok(timedOutRun.steps[1].expiresAtMs >= disconnectedAtMs);
    return {
      disconnectedAtMs,
      reconnectedAtMs,
      desktopRpcWhileOffline: 0,
      recoveryOrder,
      timeline: [
        { kind: "model", atMs: modelCall.atMs },
        { kind: "workspace-write", observedAtMs: httpCall.atMs, path: "offline-proof.txt" },
        { kind: "http", atMs: httpCall.atMs },
        { kind: "channel", atMs: channelCall.atMs },
        { kind: "approval-timeout", atMs: timedOut.atMs, runId: expired.id },
        { kind: "post-reconnect-resume", atMs: resumed.atMs, runId: waiting.id },
        { kind: "live-event", atMs: liveEvent.atMs, runId: liveRun },
      ],
      modelTools: ["automation_result", "write"],
      workspaceWriteMatched: true,
      recovered: {
        tasks: tasks.tasks.map(({ id }) => id),
        waitingRun: waiting.id,
        timedOutRun: expired.id,
        inboxRun: item.runId,
        allOfflineRunIds: offlineRunIds,
      },
      externalRequests: boundary.safeLog(),
    };
  } catch (error) {
    if (daemon) console.error(daemon.log());
    throw error;
  } finally {
    offlineGate.release();
    unsubscribe?.();
    await disposeAll(
      () => ui?.dispose(),
      () => daemon?.dispose(),
      () => boundary.close(),
    );
  }
}
