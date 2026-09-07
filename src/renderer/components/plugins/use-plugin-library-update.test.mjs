import assert from "node:assert/strict";
import test from "node:test";
import { act, useEffect } from "react";

// A dedicated characterization of the successful update path: the original
// request identity, the returned package/version data, the success feedback,
// and busy-state cleanup. Lives beside use-plugin-library.test.mjs and shares
// its harness through plugin-library-test-support.mjs.

import {
  createProbe,
  loadWith,
  mountProbe,
  pkg,
  pluginsResponse,
  withEnvironment,
} from "./plugin-library-test-support.mjs";

test("the shared scope unmounts probes even when the test body fails", async () => {
  const cleanups = { count: 0 };
  function CleanupProbe() {
    useEffect(() => {
      return () => {
        cleanups.count += 1;
      };
    }, []);
    return null;
  }
  let caught = null;
  await withEnvironment(async () => {
    await mountProbe(CleanupProbe, {});
    throw new Error("simulated assertion failure");
  }).catch((error) => {
    caught = error;
  });
  assert.ok(caught, "the failure propagated out of the shared scope");
  assert.equal(cleanups.count, 1, "exactly one unmount ran without any manual rescue");
});

test("a successful update posts the original identity, applies the returned package, and clears the busy mark", async () => {
  await withEnvironment(async (env) => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(Probe, { cwd: "/repo", sessionId: null });
    await loadWith(env, state, [pkg("npm:one", "project")]);
    const before = state.value.packages[0];

    let action;
    await act(async () => {
      action = state.value.runAction("update", before);
    });
    assert.equal(state.value.busyKey, "update:project\0npm:one");
    assert.equal(state.value.actionError, null);
    assert.equal(state.value.actionMessage, null);

    await act(async () => {
      env.pending[1].deferred.resolve({
        ok: true,
        json: async () =>
          pluginsResponse([pkg("npm:one", "project", { version: "1.2.0", configuredVersion: "1.2.0" })]),
      });
      await action;
    });

    const request = JSON.parse(env.pending[1].options.body);
    assert.equal(env.pending[1].url, "/api/plugins");
    assert.equal(env.pending[1].options.method, "POST");
    assert.equal(request.action, "update");
    assert.equal(request.source, "npm:one");
    assert.equal(request.scope, "project");
    assert.equal(request.cwd, "/repo");

    assert.equal(state.value.packages[0].version, "1.2.0");
    assert.equal(state.value.packages[0].configuredVersion, "1.2.0");
    assert.equal(state.value.actionMessage, "Package updated.");
    assert.equal(state.value.actionError, null);
    assert.equal(state.value.busyKey, null);
    assert.equal(state.value.capabilityIssue, null);
    await mounted.unmount();
  });
});

test("a failed update keeps the previous package and reports the error", async () => {
  await withEnvironment(async (env) => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(Probe, { cwd: "/repo", sessionId: null });
    await loadWith(env, state, [pkg("npm:one", "project", { version: "1.0.0" })]);
    let action;
    await act(async () => {
      action = state.value.runAction("update", state.value.packages[0]);
    });
    await act(async () => {
      env.pending[1].deferred.resolve({
        ok: true,
        json: async () => ({ error: "registry unreachable" }),
      });
      await action;
    });
    assert.equal(state.value.actionError, "registry unreachable");
    assert.equal(state.value.actionMessage, null);
    assert.equal(state.value.packages[0].version, "1.0.0");
    assert.equal(state.value.busyKey, null);
    await mounted.unmount();
  });
});

test("the update response shape the hook commits matches the documented PluginsResponse", async () => {
  await withEnvironment(async (env) => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(Probe, { cwd: "/repo", sessionId: null });
    await loadWith(env, state, [pkg("npm:one", "project")]);
    let action;
    await act(async () => {
      action = state.value.runAction("update", state.value.packages[0]);
    });
    await act(async () => {
      env.pending[1].deferred.resolve({
        ok: true,
        json: async () => pluginsResponse([pkg("npm:one", "project", { version: "2.0.0" })], { diagnostics: [] }),
      });
      await action;
    });
    assert.deepEqual(
      state.value.packages.map((entry) => entry.version),
      ["2.0.0"],
    );
    assert.equal(state.value.error, null);
    await mounted.unmount();
  });
});
