import assert from "node:assert/strict";
import { disposeAll, packagedDaemon, task, http, startRun, phase, until } from "./fixture.mjs";
import { desktop, managerRenderer, rejectRenderer } from "./desktop.mjs";
import { primaryHost } from "./primary.mjs";
import { loopback, digest } from "./boundaries.mjs";

export async function isolation() {
  const boundary = await loopback();
  let daemon;
  let primary;
  let ui;
  let remoteRenderer;
  let primaryRenderer;
  let unsubscribe;
  try {
    primary = await primaryHost();
    daemon = await packagedDaemon("e4");
    let connection = await daemon.connect();
    ui = await desktop(daemon, { primary });
    const command = (type, environmentId, extra = {}) => ui.authority({ type, environmentId, ...extra });
    const values = { primary: "primary-secret-canary", remoteA: "remote-secret-canary" };
    await command("set-secret", "primary", { name: "shared.token", value: values.primary });
    await command("set-secret", ui.environmentId, { name: "shared.token", value: values.remoteA });
    const primarySpec = task(primary.cwd, "dual-env-task", [
      http("send", boundary.origin, "/dual-primary", { secretHeaders: { "x-secret": "shared.token" } }),
    ]);
    const remoteSpec = task(daemon.cwd, "dual-env-task", [
      http("send", boundary.origin, "/dual-remote", { secretHeaders: { "x-secret": "shared.token" } }),
    ]);
    const primarySaved = await ui.enable(primary.rpc, primarySpec, "primary");
    const remoteSaved = await ui.enable(connection.rpc, remoteSpec);
    assert.equal(ui.dialogs.length, 2);
    const dialogCounts = { primary: 0, remoteA: 0 };
    for (const [index, environmentId, displayName, cwd, saved] of [
      [0, "primary", "Primary", primary.cwd, primarySaved],
      [1, ui.environmentId, "Remote A", daemon.cwd, remoteSaved],
    ]) {
      const dialog = ui.dialogs[index];
      assert.equal(dialog.defaultId, 0);
      assert.equal(dialog.cancelId, 0);
      for (const value of [
        displayName,
        environmentId,
        cwd,
        boundary.origin,
        "shared.token",
        saved.planHash,
        "http_write",
      ])
        assert.ok(dialog.detail.includes(value), value);
      if (environmentId === "primary") dialogCounts.primary++;
      else {
        assert.ok(dialog.detail.includes(connection.descriptor.environmentId));
        dialogCounts.remoteA++;
      }
    }
    assert.deepEqual(dialogCounts, { primary: 1, remoteA: 1 });
    primaryRenderer = await managerRenderer(ui.manager, "primary", primary.responses);
    remoteRenderer = await managerRenderer(ui.manager, ui.environmentId, daemon.responses);
    const events = [];
    unsubscribe = primaryRenderer.rpc.subscribe("automation.changed", "*", (event) =>
      events.push({ ...event, atMs: Date.now() }),
    );
    const methods = ["automation.enableTask", "automation.resolveAttention", "automation.setSecret"];
    const beforePrimary = await primary.rpc.call("automation.getTask", { taskId: primarySpec.id });
    const beforeRemote = await connection.rpc.call("automation.getTask", { taskId: remoteSpec.id });
    const primaryBridge = await rejectRenderer(primaryRenderer, methods, {
      "automation.enableTask": {
        taskId: primarySpec.id,
        revision: primarySaved.revision,
        planHash: primarySaved.planHash,
      },
      "automation.setSecret": { name: "shared.token", value: "compromised-primary" },
    });
    const remoteBridge = await rejectRenderer(remoteRenderer, methods, {
      "automation.enableTask": {
        taskId: remoteSpec.id,
        revision: remoteSaved.revision,
        planHash: remoteSaved.planHash,
      },
      "automation.setSecret": { name: "shared.token", value: "compromised-remote" },
    });
    assert.deepEqual(await primary.rpc.call("automation.getTask", { taskId: primarySpec.id }), beforePrimary);
    assert.deepEqual(await connection.rpc.call("automation.getTask", { taskId: remoteSpec.id }), beforeRemote);
    const primaryRun = await startRun(primary.rpc, primarySpec.id);
    const remoteRun = await startRun(connection.rpc, remoteSpec.id);
    await phase(primary.rpc, primaryRun, "succeeded");
    await phase(connection.rpc, remoteRun, "succeeded");
    const primaryRequest = await boundary.wait("/dual-primary");
    const remoteRequest = await boundary.wait("/dual-remote");
    assert.equal(primaryRequest.headers["x-secret"], values.primary);
    assert.equal(remoteRequest.headers["x-secret"], values.remoteA);
    assert.notEqual(primaryRequest.headers["x-secret"], remoteRequest.headers["x-secret"]);
    remoteRenderer.close();
    remoteRenderer = undefined;
    await ui.disconnect();
    connection.close();
    const disconnectedAtMs = Date.now();
    const authorityCallsBefore = ui.audit.length;
    for (const type of ["set-secret", "delete-secret", "list-secret-names", "enable-task", "resolve-attention"]) {
      await assert.rejects(
        command(type, ui.environmentId, {
          name: "shared.token",
          value: "must-not-fallback",
          taskId: remoteSpec.id,
          revision: remoteSaved.revision,
          planHash: remoteSaved.planHash,
          request: { runId: remoteRun },
        }),
        (error) => error.code === "DISCONNECTED",
      );
    }
    assert.equal(ui.audit.length, authorityCallsBefore);
    assert.deepEqual(await command("list-secret-names", "primary"), { names: ["shared.token"] });
    await command("set-secret", "primary", { name: "temporary", value: "primary-offline-management" });
    assert.deepEqual(await command("list-secret-names", "primary"), { names: ["shared.token", "temporary"] });
    await command("delete-secret", "primary", { name: "temporary" });
    const offlineRun = await startRun(primaryRenderer.rpc, primarySpec.id);
    await phase(primary.rpc, offlineRun, "succeeded");
    const offlineEvent = await until(
      () => events.find((event) => event.runIds.includes(offlineRun)),
      "primary events while remote is disconnected",
    );
    assert.ok(offlineEvent.atMs >= disconnectedAtMs);
    const primaryOfflineRequest = boundary.requests.filter(({ url }) => url === "/dual-primary").at(-1);
    assert.equal(primaryOfflineRequest.headers["x-secret"], values.primary);
    assert.ok(primaryOfflineRequest.atMs >= disconnectedAtMs);
    assert.equal(primary.vault.get("shared.token"), values.primary);
    const reconnectedAtMs = Date.now();
    await ui.connect();
    connection = await daemon.connect();
    remoteRenderer = await managerRenderer(ui.manager, ui.environmentId, daemon.responses);
    const remoteEvents = [];
    const remove = remoteRenderer.rpc.subscribe("automation.changed", "*", (event) => remoteEvents.push(event));
    try {
      const recovered = await remoteRenderer.rpc.call("automation.listTasks");
      assert.equal(recovered.tasks.find(({ id }) => id === remoteSpec.id).enabledRevision, remoteSaved.revision);
      assert.deepEqual(await command("list-secret-names", ui.environmentId), { names: ["shared.token"] });
      const reconciledRun = await startRun(remoteRenderer.rpc, remoteSpec.id);
      await phase(connection.rpc, reconciledRun, "succeeded");
      await until(
        () => remoteEvents.some((event) => event.runIds.includes(reconciledRun)),
        "remote changed event after reconnect",
      );
      assert.equal(
        boundary.requests.filter(({ url }) => url === "/dual-remote").at(-1).headers["x-secret"],
        values.remoteA,
      );
      assert.deepEqual(dialogCounts, { primary: 1, remoteA: 1 });
      assert.equal(ui.dialogs.length, 2);
      for (const secret of Object.values(values)) {
        assert.equal(
          (JSON.stringify([...primary.responses, ...daemon.responses]) + primary.log() + daemon.log()).includes(secret),
          false,
        );
      }
      return {
        dialogCounts,
        dialogs: ui.dialogs,
        routingAudit: ui.audit,
        environments: {
          primary: {
            environmentId: "primary",
            taskId: primarySpec.id,
            runId: primaryRun,
            secretSha256: digest(values.primary),
          },
          remoteA: {
            environmentId: ui.environmentId,
            serverEnvironmentId: connection.descriptor.environmentId,
            taskId: remoteSpec.id,
            runId: remoteRun,
            secretSha256: digest(values.remoteA),
          },
        },
        renderer: { primary: primaryBridge, remoteA: remoteBridge },
        disconnectedAtMs,
        reconnectedAtMs,
        isolation: {
          noCrossContamination: true,
          disconnectedCommandsRejected: 5,
          fallbackCalls: 0,
          primaryOfflineRun: offlineRun,
          primaryOfflineEventAtMs: offlineEvent.atMs,
          primarySecretManagementContinued: true,
          remoteReconciledRun: reconciledRun,
          remoteEventRecovered: true,
        },
        externalRequests: boundary.safeLog(),
      };
    } finally {
      remove();
    }
  } catch (error) {
    if (primary) console.error(primary.log());
    if (daemon) console.error(daemon.log());
    throw error;
  } finally {
    unsubscribe?.();
    remoteRenderer?.close();
    primaryRenderer?.close();
    await disposeAll(
      () => ui?.dispose(),
      () => primary?.dispose(),
      () => daemon?.dispose(),
      () => boundary.close(),
    );
  }
}
