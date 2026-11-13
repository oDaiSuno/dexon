import assert from "node:assert/strict";
import test from "node:test";
import { hostSelfCheckFailures } from "./host-self-check.ts";

const report = {
  models: { ok: true, modelCount: 0, catalogSource: "offline" },
  pluginWorker: { ok: true, installed: true, removed: true },
  managedProcess: { ok: true, readyLineSeen: true, finalState: "killed" },
};

test("self-check validation requires successful real model, plugin and process outcomes", () => {
  assert.deepEqual(hostSelfCheckFailures(report, { offline: true }), []);
  for (const state of ["lost", "failed", "running", "ready", "starting", "stopping"]) {
    assert.ok(
      hostSelfCheckFailures(
        { ...report, managedProcess: { ...report.managedProcess, finalState: state } },
        { offline: true },
      ).length > 0,
      state,
    );
  }
  for (const probe of ["models", "pluginWorker", "managedProcess"]) {
    assert.ok(
      hostSelfCheckFailures({ ...report, [probe]: { ok: false, error: "ENOTDIR spawn" } }, { offline: true }).some(
        (failure) => failure.includes("ENOTDIR"),
      ),
    );
  }
  assert.ok(hostSelfCheckFailures(undefined, { offline: true }).length > 0);
  assert.ok(
    hostSelfCheckFailures({ ...report, models: { ok: true, modelCount: 1, catalogSource: "cache" } }, { offline: true })
      .length > 0,
  );
  assert.ok(
    hostSelfCheckFailures(
      { ...report, pluginWorker: { ok: true, installed: true, removed: false } },
      { offline: false },
    ).length > 0,
  );
  assert.ok(
    hostSelfCheckFailures(
      { ...report, managedProcess: { ok: true, readyLineSeen: false, finalState: "exited" } },
      { offline: false },
    ).length > 0,
  );
});

test("workspace cleanup failure does not erase the model probe cause", () => {
  const failures = hostSelfCheckFailures(
    { ...report, models: { ok: false, error: "ENOTDIR" }, cleanup: { ok: false, error: "EACCES" } },
    { offline: true },
  );
  assert.ok(failures.some((failure) => failure.includes("ENOTDIR")));
  assert.ok(failures.some((failure) => failure.includes("cleanup: EACCES")));
});
