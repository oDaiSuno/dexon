import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { disposeAll, packagedDaemon, task, http, approval, startRun, phase, until, alive } from "./fixture.mjs";
import { desktop } from "./desktop.mjs";
import { loopback } from "./boundaries.mjs";
import { daemonIsIdle } from "../../src/main/environments/remote-probe.ts";
import { planRuntimeUpgrade } from "../../src/main/environments/remote-provisioner.ts";
import { closeModeFor } from "../../src/main/environments/environment-lifecycle.ts";
import { DAEMON_EXIT_DEADLINE_MS } from "../../src/shared/shutdown-budget.ts";

export async function lifecycle() {
  const boundary = await loopback();
  let daemon;
  let ui;
  const holds = [];
  try {
    daemon = await packagedDaemon("e3");
    let connection = await daemon.connect();
    let rpc = connection.rpc;
    ui = await desktop(daemon);
    assert.deepEqual((await rpc.call("sessions.list")).runningSessionIds, []);
    const beforePid = daemon.pid;
    const watchHold = boundary.hold("/watch-held");
    holds.push(watchHold);
    const watch = task(daemon.cwd, "active-watch", [approval("never")], {
      triggers: [
        {
          id: "watch",
          kind: "watch",
          every: "30s",
          probe: {
            action: "http.request",
            with: { url: { origin: boundary.origin, path: "/watch-held" }, method: "GET", timeout: "120s" },
          },
          mode: { type: "threshold", healthy: { ref: "probe.ok", op: "eq", value: true }, consecutive: 1 },
        },
      ],
    });
    await ui.enable(rpc, watch);
    const detachedHold = boundary.hold("/detached-held");
    holds.push(detachedHold);
    const detachedTask = task(daemon.cwd, "detached-survival", [
      http("held", boundary.origin, "/detached-held", { timeout: "120s" }),
    ]);
    await ui.enable(rpc, detachedTask);
    const detachedRun = await startRun(rpc, detachedTask.id);
    await detachedHold.wait();
    assert.equal(closeModeFor("disconnect", { detachedDaemon: true, autoReconnect: false }), "disconnect");
    await ui.disconnect();
    connection.close();
    assert.equal(alive(beforePid), true);
    detachedHold.release();
    connection = await daemon.connect();
    rpc = connection.rpc;
    await phase(rpc, detachedRun, "succeeded");
    assert.equal(daemon.pid, beforePid);
    assert.equal(alive(beforePid), true);
    await ui.connect();
    const busyHold = boundary.hold("/busy-held");
    holds.push(busyHold);
    const busyTask = task(daemon.cwd, "busy-upgrade", [
      http("held", boundary.origin, "/busy-held", { timeout: "120s" }),
    ]);
    await ui.enable(rpc, busyTask);
    const busyRun = await startRun(rpc, busyTask.id);
    await busyHold.wait();
    writeFileSync(
      path.join(daemon.cwd, "cancel.mjs"),
      `process.on("SIGTERM", () => {});\nawait fetch(${JSON.stringify(`${boundary.origin}/cancel-started`)}, { method: "POST" });\nsetInterval(() => {}, 1000);\n`,
    );
    const cancelTask = task(daemon.cwd, "cancelling-protection", [
      {
        id: "script",
        kind: "action",
        call: { action: "script.run", with: { path: "cancel.mjs", effect: "unsafe", timeout: "120s" } },
      },
    ]);
    await ui.enable(rpc, cancelTask);
    const cancelRun = await startRun(rpc, cancelTask.id);
    await boundary.wait("/cancel-started");
    const cancellation = rpc.call("automation.cancelRun", { runId: cancelRun });
    const cancellingActivity = await until(
      async () => {
        const activity = await rpc.call("automation.activity");
        return activity.cancellingRuns > 0 && activity;
      },
      "cancelling run counted",
      2000,
    );
    await cancellation;
    await phase(rpc, cancelRun, "cancelled");
    await until(() => boundary.requests.some(({ url }) => url === "/watch-held"), "real scheduled watch probe", 45000);
    const active = await rpc.call("automation.activity");
    assert.ok(active.executingRuns > 0);
    assert.ok(active.activeProbes > 0);
    const busyProbe = await daemon.probe();
    assert.equal(busyProbe.daemon.activeSessions, 0);
    assert.ok(busyProbe.daemon.activeAutomation > 0);
    assert.equal(daemonIsIdle(busyProbe.daemon), false);
    const busyDecision = planRuntimeUpgrade(busyProbe, "9.9.9-upgrade");
    assert.equal(busyDecision.updatePending, true);
    assert.equal(busyDecision.restartDaemon, false);
    assert.equal(alive(beforePid), true);
    assert.equal((await phase(rpc, busyRun, "running")).phase, "running");
    await ui.dispose();
    ui = undefined;
    const managedStop = await daemon.stop();
    assert.ok(managedStop.elapsedMs <= DAEMON_EXIT_DEADLINE_MS + 2000);
    assert.equal(alive(beforePid), false);
    connection.close();
    for (const hold of holds) hold.release();
    await daemon.start();
    connection = await daemon.connect();
    rpc = connection.rpc;
    await rpc.call("automation.disableTask", { taskId: watch.id });
    ui = await desktop(daemon);
    const waitingSpec = task(daemon.cwd, "waiting-upgrade", [
      approval("approval"),
      http("resume", boundary.origin, "/waiting-resumed"),
    ]);
    await ui.enable(rpc, waitingSpec);
    const waitingRunId = await startRun(rpc, waitingSpec.id);
    const waitingRun = await phase(rpc, waitingRunId, "waiting");
    const inboxBefore = (await rpc.call("automation.listInbox")).items.find(({ runId }) => runId === waitingRunId);
    assert.ok(inboxBefore);
    await until(async () => {
      const a = await rpc.call("automation.activity");
      return a.executingRuns === 0 && a.cancellingRuns === 0 && a.activeProbes === 0;
    }, "waiting-only idle state");
    const waitingProbe = await daemon.probe();
    assert.equal(waitingProbe.daemon.activeSessions, 0);
    assert.equal(waitingProbe.daemon.activeAutomation, 0);
    assert.equal(daemonIsIdle(waitingProbe.daemon), true);
    const waitingDecision = planRuntimeUpgrade(waitingProbe, "9.9.9-upgrade");
    assert.equal(waitingDecision.restartDaemon, true);
    assert.equal(waitingDecision.updatePending, false);
    const oldPid = daemon.pid;
    await ui.dispose();
    ui = undefined;
    const waitingStop = await daemon.stop();
    connection.close();
    await daemon.start();
    const newPid = daemon.pid;
    assert.notEqual(newPid, oldPid);
    connection = await daemon.connect();
    rpc = connection.rpc;
    const recoveredTask = (await rpc.call("automation.getTask", { taskId: waitingSpec.id })).task;
    const recoveredRun = await phase(rpc, waitingRunId, "waiting");
    const recoveredInbox = (await rpc.call("automation.listInbox")).items.find(({ runId }) => runId === waitingRunId);
    assert.equal(recoveredTask.source.name, waitingSpec.name);
    assert.equal(recoveredRun.revision, waitingRun.revision);
    assert.deepEqual(recoveredInbox, inboxBefore);
    ui = await desktop(daemon);
    await ui.manager.setPolicy({ detachedDaemon: false });
    assert.equal(closeModeFor("disconnect", { detachedDaemon: false, autoReconnect: false }), "stop-managed");
    assert.equal(
      (await ui.manager.listEnvironments()).find(({ id }) => id === ui.environmentId).target.kind,
      "websocket",
    );
    const directBefore = daemon.pid;
    await assert.rejects(ui.manager.restartDaemon(ui.environmentId), /Only managed SSH/);
    await ui.disconnect();
    connection.close();
    assert.equal(alive(directBefore), true);
    const reconnected = await ui.connect();
    assert.equal(reconnected.runtime.ownership, "external");
    assert.equal(reconnected.runtime.updatePending, false);
    assert.equal(daemon.pid, directBefore);
    await ui.dispose();
    ui = undefined;
    assert.equal(alive(directBefore), true);
    return {
      detached: { beforePid, afterPid: beforePid, completedRunId: detachedRun, pidAliveAfterDisconnect: true },
      busy: { pid: beforePid, activity: active, cancellingActivity, probe: busyProbe.daemon, decision: busyDecision },
      managedStop,
      waiting: {
        oldPid,
        newPid,
        probe: waitingProbe.daemon,
        decision: waitingDecision,
        stop: waitingStop,
        recoveredTaskId: recoveredTask.taskId,
        recoveredRunId: recoveredRun.id,
        recoveredPhase: recoveredRun.phase,
        recoveredInboxMatched: true,
      },
      websocketDirect: {
        beforePid: directBefore,
        afterPid: directBefore,
        restartRejected: true,
        pidAliveAfterDisconnectAndShutdown: true,
        ownership: reconnected.runtime.ownership,
        updatePending: false,
      },
    };
  } catch (error) {
    if (daemon) console.error(daemon.log());
    throw error;
  } finally {
    for (const hold of holds) hold.release();
    await disposeAll(
      () => ui?.dispose(),
      () => daemon?.dispose(),
      () => boundary.close(),
    );
  }
}
