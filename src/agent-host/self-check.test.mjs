import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";
import { runHostSelfCheck } from "./self-check.ts";
import { hostSelfCheckFailures } from "../shared/host-self-check.ts";

function services(patch = {}) {
  const observed = { actions: [], processes: [], dismissed: [], workspaces: [] };
  const deps = {
    async listModels(cwd) {
      observed.workspaces.push(cwd);
      return { models: [], catalog: { source: "offline" } };
    },
    async applyPluginAction(body) {
      observed.actions.push(body.action);
      await access(`${body.source}/package.json`);
      await access(`${body.source}/index.js`);
      return {
        packages:
          body.action === "install"
            ? [{ source: "../plugin", installedPath: body.source, scope: "project", status: "installed" }]
            : [],
      };
    },
    managedProcesses: {
      async startForAgent(owner, cwd, trusted, params) {
        assert.equal(trusted, true);
        assert.equal(params.command, "printf 'dexon-self-check-ready\\n'; read -r _");
        assert.equal(params.activateUi, false);
        const process = { processId: "probe", runId: "run", state: "ready", ownerSessionId: owner };
        observed.processes.push(process);
        return { process, readiness: { state: "ready" }, output: { records: [{ text: "dexon-self-check-ready\n" }] } };
      },
      async stop(id, runId, mode, source, owner) {
        assert.equal(id, "probe");
        assert.equal(runId, "run");
        assert.equal(mode, "graceful");
        assert.equal(source, "agent");
        assert.equal(owner, observed.processes[0].ownerSessionId);
        return { ...observed.processes[0], state: "killed" };
      },
      dismiss(id) {
        observed.dismissed.push(id);
        return { ok: true };
      },
      list() {
        return { processes: observed.processes };
      },
    },
    ...patch,
  };
  return { deps, observed };
}

test("host self-check observes models, local plugin install/removal, process readiness/stop and cleans its workspace", async () => {
  const { deps, observed } = services();
  const report = await runHostSelfCheck(deps);
  assert.deepEqual(hostSelfCheckFailures(report, { offline: true }), []);
  assert.deepEqual(observed.actions, ["install", "remove"]);
  assert.deepEqual(observed.dismissed, ["probe"]);
  await assert.rejects(access(observed.workspaces[0]), { code: "ENOENT" });
});

test("a later timed out probe cannot hide an earlier OS error and all probes remain bounded", async () => {
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const { deps } = services({
      async listModels() {
        throw Object.assign(new Error("catalog failed token=private"), { code: "ENOTDIR", syscall: "spawn" });
      },
      async applyPluginAction() {
        return new Promise(() => {});
      },
    });
    const report = await runHostSelfCheck(deps, { timeoutMs: 20 });
    const failures = hostSelfCheckFailures(report, { offline: true });
    assert.ok(failures.some((failure) => failure.includes("ENOTDIR")));
    assert.ok(failures.some((failure) => failure.startsWith("pluginWorker:")));
    assert.ok(!JSON.stringify(report).includes("private"));
  } finally {
    clearTimeout(keepAlive);
  }
});

test("plugin cleanup timeout cannot replace the install OS cause", async () => {
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const { deps } = services({
      async applyPluginAction(body) {
        if (body.action === "install") throw Object.assign(new Error("install failed"), { code: "ENOTDIR" });
        return new Promise(() => {});
      },
    });
    const report = await runHostSelfCheck(deps, { timeoutMs: 20 });
    assert.equal(report.pluginWorker.ok, false);
    assert.match(report.pluginWorker.error, /ENOTDIR/);
  } finally {
    clearTimeout(keepAlive);
  }
});

test("process stop has its own deadline and readiness failures retain redacted shell output", async () => {
  const { deps } = services();
  const start = deps.managedProcesses.startForAgent;
  deps.managedProcesses.startForAgent = async (...args) => {
    const started = await start(...args);
    return {
      ...started,
      readiness: { state: "timed-out" },
      output: { records: [{ text: "bash ENOTDIR token=private-shell" }] },
    };
  };
  const report = await runHostSelfCheck(deps);
  assert.equal(report.managedProcess.ok, false);
  assert.match(report.managedProcess.error, /readiness was timed-out.*ENOTDIR/);
  assert.ok(!report.managedProcess.error.includes("private-shell"));
  deps.managedProcesses.stop = async () => new Promise(() => {});
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const timedOut = await runHostSelfCheck(deps, { timeoutMs: 20 });
    assert.equal(timedOut.managedProcess.ok, false);
    assert.match(timedOut.managedProcess.error, /timeout/i);
  } finally {
    clearTimeout(keepAlive);
  }
});

test("a background task refused by platform policy is reported as unsupported rather than a crash", async () => {
  const { deps } = services();
  deps.managedProcesses.startForAgent = async () => {
    throw Object.assign(new Error("Managed process containment is not ready"), {
      code: "PROCESS_FEATURE_DISABLED",
      details: { subcode: "PLATFORM_UNSUPPORTED" },
    });
  };
  const report = await runHostSelfCheck(deps);
  assert.equal(report.managedProcess.ok, false);
  assert.equal(report.managedProcess.platformUnsupported, true);
  assert.deepEqual(hostSelfCheckFailures(report, { offline: true, managedProcessSupported: false }), []);
});
