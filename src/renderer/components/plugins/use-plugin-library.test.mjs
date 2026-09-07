import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";

// Characterization tests for the split plugin library owner: list loading
// and selection fallbacks, the five package actions and their messages,
// source installs with installed-package alignment, the capability repair
// pending operation, and the explicit session reload chain. The esbuild
// bundle, deferred fetch harness, and probe helpers live in
// plugin-library-test-support.mjs.

import {
  createProbe,
  loadWith,
  mountProbe,
  pkg,
  pluginsResponse,
  withEnvironment,
} from "./plugin-library-test-support.mjs";

test("loads plugins on mount, groups by scope, and selects the first entry", async () => {
  await withEnvironment(async (env) => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(Probe, { cwd: "/repo", sessionId: null });
    assert.equal(state.value.loading, true);
    const value = await loadWith(env, state, [pkg("npm:one", "project"), pkg("npm:two", "global")]);
    assert.equal(value.loading, false);
    assert.equal(value.error, null);
    assert.deepEqual(
      value.packages.map((entry) => entry.source),
      ["npm:one", "npm:two"],
    );
    assert.deepEqual(
      value.groupedPackages.map((group) => group.scope),
      ["project", "global"],
    );
    assert.equal(value.selected, "project\0npm:one");
    assert.equal(value.addMode, false);
    assert.equal(env.pending[0].url, "/api/plugins?cwd=%2Frepo");
    await mounted.unmount();
  });
});

test("an empty package list opens the add panel with no selection", async () => {
  await withEnvironment(async (env) => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(Probe, { cwd: "/repo", sessionId: null });
    const value = await loadWith(env, state, []);
    assert.equal(value.addMode, true);
    assert.equal(value.selected, null);
    assert.equal(value.selectedPackage, null);
    await mounted.unmount();
  });
});

test("a refresh keeps the selection when it still exists and falls back otherwise", async () => {
  await withEnvironment(async (env) => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(Probe, { cwd: "/repo", sessionId: null });
    await loadWith(env, state, [pkg("npm:one", "project"), pkg("npm:two", "global")]);
    await act(async () => {
      state.value.selectPackage("global\0npm:two");
    });
    assert.equal(state.value.selected, "global\0npm:two");
    await act(async () => {
      state.value.loadPlugins();
    });
    await loadWith(env, state, [pkg("npm:two", "global"), pkg("npm:three", "project")]);
    assert.equal(state.value.selected, "global\0npm:two", "kept when still present");
    await act(async () => {
      state.value.loadPlugins();
    });
    await loadWith(env, state, [pkg("npm:nine", "global")]);
    assert.equal(state.value.selected, "global\0npm:nine", "falls back to the first entry");
    await mounted.unmount();
  });
});

test("the disable action updates the data and reports the outcome", async () => {
  await withEnvironment(async (env) => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(Probe, { cwd: "/repo", sessionId: null });
    await loadWith(env, state, [pkg("npm:one", "project")]);
    let action;
    await act(async () => {
      action = state.value.runAction("disable", state.value.packages[0]);
    });
    assert.equal(state.value.busyKey, "disable:project\0npm:one");
    await act(async () => {
      env.pending[1].deferred.resolve({
        ok: true,
        json: async () => pluginsResponse([pkg("npm:one", "project", { disabled: true, status: "disabled" })]),
      });
      await action;
    });
    assert.equal(state.value.busyKey, null);
    assert.equal(state.value.packages[0].disabled, true);
    assert.equal(state.value.actionMessage, "Package disabled.");
    assert.equal(state.value.actionError, null);
    assert.equal(JSON.parse(env.pending[1].options.body).action, "disable");
    await mounted.unmount();
  });
});

test("removing the last package clears the selection and opens the add panel", async () => {
  await withEnvironment(async (env) => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(Probe, { cwd: "/repo", sessionId: null });
    await loadWith(env, state, [pkg("npm:one", "project")]);
    let action;
    await act(async () => {
      action = state.value.runAction("remove", state.value.packages[0]);
    });
    await act(async () => {
      env.pending[1].deferred.resolve({ ok: true, json: async () => pluginsResponse([]) });
      await action;
    });
    assert.equal(state.value.actionMessage, "Package removed.");
    assert.equal(state.value.selected, null);
    assert.equal(state.value.addMode, true);
    await mounted.unmount();
  });
});

test("removing one of several packages selects the first remaining package", async () => {
  await withEnvironment(async (env) => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(Probe, { cwd: "/repo", sessionId: null });
    await loadWith(env, state, [pkg("npm:one", "project"), pkg("npm:two", "project")]);
    await act(async () => {
      state.value.selectPackage("project\0npm:two");
    });
    let action;
    await act(async () => {
      action = state.value.runAction("remove", state.value.packages[1]);
    });
    await act(async () => {
      env.pending[1].deferred.resolve({
        ok: true,
        json: async () => pluginsResponse([pkg("npm:one", "project")]),
      });
      await action;
    });
    assert.equal(state.value.selected, "project\0npm:one");
    assert.equal(state.value.addMode, false);
    await mounted.unmount();
  });
});

test("a failed action maps missing developer tools to the repair guidance", async () => {
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
        ok: false,
        json: async () => ({ error: "spawn npm ENOENT" }),
      });
      await action;
    });
    assert.equal(
      state.value.actionError,
      "A required developer tool is unavailable. Rescan tools or install the matching Essentials profile.",
    );
    assert.equal(state.value.actionMessage, null);
    await mounted.unmount();
  });
});

test("a capability requirement holds the operation; retry re-runs it and cancel clears it", async () => {
  await withEnvironment(async (env) => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(Probe, { cwd: "/repo", sessionId: null });
    await loadWith(env, state, [pkg("npm:one", "project")]);
    let action;
    await act(async () => {
      action = state.value.runAction("enable", state.value.packages[0]);
    });
    await act(async () => {
      env.pending[1].deferred.resolve({
        ok: false,
        json: async () => ({ code: "TOOLCHAIN_NODE_REQUIRED", capability: "js.node" }),
      });
      await action;
    });
    assert.notEqual(state.value.capabilityIssue, null);
    assert.equal(state.value.actionError, null);
    assert.equal(state.value.busyKey, null);

    // Cancel clears the pending operation without applying anything.
    await act(async () => {
      state.value.clearCapabilityPending();
    });
    assert.equal(state.value.capabilityIssue, null);

    // Retry after re-arming issues the same action again.
    await act(async () => {
      state.value.runAction("enable", state.value.packages[0]);
    });
    await act(async () => {
      env.pending[2].deferred.resolve({
        ok: false,
        json: async () => ({ code: "TOOLCHAIN_NODE_REQUIRED", capability: "js.node" }),
      });
      await env.pending[2].deferred.promise;
    });
    assert.notEqual(state.value.capabilityIssue, null);
    let retry;
    await act(async () => {
      retry = state.value.retryCapabilityOperation();
    });
    await act(async () => {
      env.pending[3].deferred.resolve({
        ok: true,
        json: async () => pluginsResponse([pkg("npm:one", "project")]),
      });
      await retry;
    });
    assert.equal(state.value.capabilityIssue, null);
    assert.equal(state.value.actionMessage, "Package enabled.");
    await mounted.unmount();
  });
});

test("installing a source aligns the selection with the installed package and clears the form", async () => {
  await withEnvironment(async (env) => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(Probe, { cwd: "/repo", sessionId: null });
    await loadWith(env, state, [pkg("npm:existing", "global")]);
    await act(async () => {
      state.value.openAddMode();
      state.value.setInstallSource("new-package");
    });
    assert.equal(state.value.addMode, true);
    let install;
    await act(async () => {
      install = state.value.installPluginSource("new-package", "project");
    });
    await act(async () => {
      env.pending[1].deferred.resolve({
        ok: true,
        json: async () => pluginsResponse([pkg("npm:existing", "global"), pkg("npm:new-package", "project")]),
      });
      await install;
    });
    assert.equal(state.value.addMode, false);
    assert.equal(state.value.installSource, "");
    assert.equal(state.value.selected, "project\0npm:new-package");
    assert.equal(state.value.actionMessage, "Package installed.");
    assert.equal(JSON.parse(env.pending[1].options.body).action, "install");
    await mounted.unmount();
  });
});

test("a failed install keeps the form populated and reports the error", async () => {
  await withEnvironment(async (env) => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(Probe, { cwd: "/repo", sessionId: null });
    await loadWith(env, state, [pkg("npm:existing", "global")]);
    await act(async () => {
      state.value.openAddMode();
      state.value.setInstallSource("broken-package");
    });
    let install;
    await act(async () => {
      install = state.value.installPlugin();
    });
    await act(async () => {
      env.pending[1].deferred.resolve({ ok: false, json: async () => ({ error: "quota exceeded" }) });
      await install;
    });
    assert.equal(state.value.actionError, "quota exceeded");
    assert.equal(state.value.addMode, true);
    assert.equal(state.value.installSource, "broken-package");
    await mounted.unmount();
  });
});

test("reload session chains the agent command, the reloaded callback, and a refresh", async () => {
  await withEnvironment(async (env) => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(Probe, { cwd: "/repo", sessionId: "session-1", onReloaded: env.onReloaded });
    await loadWith(env, state, [pkg("npm:one", "project")]);
    let reload;
    await act(async () => {
      reload = state.value.reloadSession();
    });
    assert.equal(state.value.busyKey, "reload");
    await act(async () => {
      env.pending[1].deferred.resolve({ ok: true, json: async () => pluginsResponse([pkg("npm:one", "project")]) });
      await reload;
    });
    assert.deepEqual(env.sentCommands, [["session-1", { type: "reload" }]]);
    assert.equal(env.reloadCount(), 1);
    assert.equal(state.value.actionMessage, "Session reloaded.");
    assert.equal(state.value.busyKey, null);
    await mounted.unmount();
  });
});

test("reload without a session does nothing and a failed reload reports the error", async () => {
  await withEnvironment(async (env) => {
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(Probe, { cwd: "/repo", sessionId: null, onReloaded: env.onReloaded });
    await loadWith(env, state, [pkg("npm:one", "project")]);
    await act(async () => {
      await state.value.reloadSession();
    });
    assert.deepEqual(env.sentCommands, []);
    assert.equal(env.reloadCount(), 0);
    await mounted.unmount();

    const { state: failState, Probe: failProbe } = createProbe();
    const failMounted = await mountProbe(failProbe, {
      cwd: "/repo",
      sessionId: "session-2",
      onReloaded: env.onReloaded,
    });
    await loadWith(env, failState, [pkg("npm:one", "project")]);
    globalThis.__pluginLibraryHarness.sendAgentCommand = () => Promise.reject(new Error("host gone"));
    let reload;
    await act(async () => {
      reload = failState.value.reloadSession();
    });
    await act(async () => {
      await reload;
    });
    assert.equal(failState.value.actionError, "host gone");
    assert.equal(failState.value.busyKey, null);
    await failMounted.unmount();
  });
});
