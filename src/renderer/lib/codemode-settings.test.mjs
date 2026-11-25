import { createDeferred } from "#test-timing";
import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { MessageChannel } from "node:worker_threads";
import {
  act,
  createElement,
  loadRenderer,
  mount,
  click,
  button,
  waitFor,
  restoreGlobals,
} from "../../../tests/support/renderer.mjs";

const api = await loadRenderer(
  "codemode-settings",
  'export * from "./src/renderer/lib/codemode-settings.ts"; export {getEnvironmentConnection} from "./src/renderer/lib/environment-registry.ts"; export {createRpcServer} from "./src/contract/rpc.ts"; export {RpcError} from "./src/contract/types.ts";',
);
after(restoreGlobals);
beforeEach(() => api.resetCodemodeSettingsCache());

const defaults = {
  enabled: true,
  mode: "on",
  configPath: "/home/dev/.pi/agent/settings.json",
  availability: { available: true },
  projectOverride: null,
};

function host(t, environmentId, get, set = () => defaults) {
  const server = api.createRpcServer();
  server.handle({ "codemode.get": get, "codemode.set": set });
  const { port1, port2 } = new MessageChannel();
  server.attachPort(port1);
  const connection = api.getEnvironmentConnection(environmentId);
  connection.replacePort(port2);
  t.after(() => {
    connection.close();
    server.detachPort(port1);
    port1.close();
    port2.close();
  });
}

function Controls({ environmentId = "alpha", cwd, onRender = () => {} }) {
  const controller = api.useCodemodeSettings(environmentId, cwd);
  onRender(controller);
  const { state, settings, saving, errorMessage } = controller;
  const action = (label, onClick) => createElement("button", { onClick }, label);
  return createElement(
    "section",
    null,
    createElement("output", null, JSON.stringify({ state, settings, saving, errorMessage })),
    action("Toggle", () => void controller.toggleEnabled(!settings?.enabled)),
    action("Only", () => void controller.setMode("only")),
    action("Reload", () => void controller.reload()),
    action("Dismiss", controller.dismissError),
    action("Burst", () => {
      void controller.toggleEnabled(!settings?.enabled);
      void controller.setMode("only");
    }),
    action("Reload and toggle", () => {
      void controller.reload();
      void controller.toggleEnabled(!settings?.enabled);
    }),
  );
}

function displayed(view) {
  return JSON.parse(view.container.querySelector("output").textContent);
}

const press = (view, label) => click(button(view.container, label));

test("the controller renders loading then ready and reload fetches fresh settings", async (t) => {
  let enabled = true;
  host(t, "alpha", () => ({ ...defaults, enabled }));
  const renders = [];
  const view = await mount(t, Controls, { onRender: (controller) => renders.push(controller.state) });
  assert.equal(renders[0], "loading");
  await waitFor(() => assert.equal(displayed(view).state, "ready"));
  assert.deepEqual(displayed(view), { state: "ready", settings: defaults, saving: false, errorMessage: null });
  enabled = false;
  await press(view, "Reload");
  await waitFor(() => assert.equal(displayed(view).settings?.enabled, false));
});

test("a failed optimistic toggle restores settings and exposes a dismissible error", async (t) => {
  const response = createDeferred();
  host(
    t,
    "alpha",
    () => defaults,
    (patch) => {
      assert.deepEqual(patch, { enabled: false, cwd: "/a" });
      return response.promise;
    },
  );
  const view = await mount(t, Controls, { cwd: "/a" });
  await waitFor(() => assert.equal(displayed(view).state, "ready"));
  await press(view, "Toggle");
  assert.equal(displayed(view).settings.enabled, false);
  assert.equal(displayed(view).saving, true);
  await act(async () => response.reject(new Error("Settings are read-only")));
  await waitFor(() => assert.equal(displayed(view).saving, false));
  assert.deepEqual(displayed(view), {
    state: "ready",
    settings: defaults,
    saving: false,
    errorMessage: "Settings are read-only",
  });
  await press(view, "Dismiss");
  assert.equal(displayed(view).errorMessage, null);
});

test("a mode save adopts the host result and blocks overlapping writes until a deferred reload", async (t) => {
  const response = createDeferred();
  let settings = defaults;
  let writes = 0;
  let reads = 0;
  host(
    t,
    "alpha",
    () => {
      reads += 1;
      return settings;
    },
    (patch) => {
      writes += 1;
      return response.promise.then(() => {
        settings = { ...defaults, ...patch, availability: { available: false, reason: "missing_sandbox" } };
        return settings;
      });
    },
  );
  const view = await mount(t, Controls);
  await waitFor(() => assert.equal(displayed(view).state, "ready"));
  await press(view, "Only");
  assert.equal(displayed(view).settings.mode, "only");
  await press(view, "Burst");
  await press(view, "Reload");
  assert.equal(displayed(view).state, "ready");
  assert.equal(displayed(view).saving, true);
  assert.equal(reads, 1);
  await act(async () => response.resolve());
  await waitFor(() => assert.equal(displayed(view).saving, false));
  await waitFor(() =>
    assert.deepEqual(displayed(view).settings?.availability, { available: false, reason: "missing_sandbox" }),
  );
  assert.equal(displayed(view).settings.mode, "only");
  assert.equal(writes, 1);
  assert.equal(reads, 2);
});

test("a save started in the same event as reload wins over the earlier read", async (t) => {
  const stale = createDeferred();
  let reads = 0;
  host(
    t,
    "alpha",
    () => (++reads === 1 ? defaults : stale.promise),
    () => ({ ...defaults, enabled: false }),
  );
  const view = await mount(t, Controls);
  await waitFor(() => assert.equal(displayed(view).state, "ready"));
  await press(view, "Reload and toggle");
  await waitFor(() => assert.equal(displayed(view).saving, false));
  assert.equal(displayed(view).state, "ready");
  assert.equal(displayed(view).settings.enabled, false);
  await act(async () => stale.resolve(defaults));
  assert.equal(displayed(view).settings.enabled, false);
});

test("environment and cwd changes render loading immediately and reject an earlier A response after A to B to A", async (t) => {
  const pending = [];
  host(t, "alpha", (params) => {
    const reply = createDeferred();
    pending.push({ params, reply });
    return reply.promise;
  });
  host(t, "beta", () => ({ ...defaults, enabled: false }));
  const renders = [];
  const onRender = (controller) => renders.push({ state: controller.state, settings: controller.settings });
  const view = await mount(t, Controls, { environmentId: "alpha", cwd: "/a", onRender });
  await waitFor(() => assert.equal(pending.length, 1));
  renders.length = 0;
  await view.update({ environmentId: "beta", cwd: "/a", onRender });
  assert.deepEqual(renders[0], { state: "loading", settings: null });
  await waitFor(() => assert.equal(displayed(view).state, "ready"));
  renders.length = 0;
  await view.update({ environmentId: "alpha", cwd: "/a", onRender });
  assert.deepEqual(renders[0], { state: "loading", settings: null });
  await waitFor(() => assert.equal(pending.length, 2));
  await act(async () => pending[0].reply.resolve({ ...defaults, enabled: false }));
  assert.equal(displayed(view).state, "loading");
  await act(async () => pending[1].reply.resolve({ ...defaults, mode: "only" }));
  await waitFor(() => assert.equal(displayed(view).settings?.mode, "only"));
  renders.length = 0;
  await view.update({ environmentId: "alpha", cwd: "/b", onRender });
  assert.deepEqual(renders[0], { state: "loading", settings: null });
  await waitFor(() => assert.equal(pending.length, 3));
  assert.deepEqual(pending[2].params, { cwd: "/b" });
  await act(async () => pending[2].reply.resolve(defaults));
  await waitFor(() => assert.equal(displayed(view).settings?.mode, "on"));
});

test("only the newest reload can update the controller and unmount discards pending responses", async (t) => {
  const pending = [];
  host(t, "alpha", () => {
    const reply = createDeferred();
    pending.push(reply);
    return reply.promise;
  });
  const view = await mount(t, Controls);
  await waitFor(() => assert.equal(pending.length, 1));
  await press(view, "Reload");
  await waitFor(() => assert.equal(pending.length, 2));
  await act(async () => pending[1].resolve({ ...defaults, mode: "only" }));
  await waitFor(() => assert.equal(displayed(view).settings?.mode, "only"));
  await act(async () => pending[0].resolve(defaults));
  assert.equal(displayed(view).settings.mode, "only");
  await press(view, "Reload");
  await waitFor(() => assert.equal(pending.length, 3));
  await view.unmount();
  await act(async () => pending[2].resolve({ ...defaults, enabled: false }));
  const next = await mount(t, Controls);
  await waitFor(() => assert.equal(pending.length, 4));
  assert.equal(displayed(next).state, "loading");
  await act(async () => pending[3].resolve(defaults));
  await waitFor(() => assert.equal(displayed(next).settings?.enabled, true));
});

test("switching projects during a save waits for completion without showing the old project's save result", async (t) => {
  const response = createDeferred();
  let enabled = true;
  host(
    t,
    "alpha",
    (params) => ({ ...defaults, enabled, mode: params?.cwd === "/b" ? "only" : "on" }),
    () =>
      response.promise.then(() => {
        enabled = false;
        return { ...defaults, enabled, projectOverride: { filePath: "/a/.pi/settings.json", mode: "on" } };
      }),
  );
  const view = await mount(t, Controls, { cwd: "/a" });
  await waitFor(() => assert.equal(displayed(view).state, "ready"));
  await press(view, "Toggle");
  await view.update({ cwd: "/b" });
  assert.equal(displayed(view).saving, false);
  await act(async () => response.resolve());
  await waitFor(() => assert.equal(displayed(view).state, "ready"));
  assert.deepEqual(displayed(view), {
    state: "ready",
    settings: { ...defaults, enabled: false, mode: "only" },
    saving: false,
    errorMessage: null,
  });
});

test("saving status belongs to the current environment while an earlier environment is still saving", async (t) => {
  const alphaWrite = createDeferred();
  const betaWrite = createDeferred();
  host(
    t,
    "alpha",
    () => defaults,
    () => alphaWrite.promise.then(() => ({ ...defaults, enabled: false })),
  );
  host(
    t,
    "beta",
    () => defaults,
    () => betaWrite.promise.then(() => ({ ...defaults, enabled: false })),
  );
  const view = await mount(t, Controls, { environmentId: "alpha" });
  await waitFor(() => assert.equal(displayed(view).state, "ready"));
  await press(view, "Toggle");
  assert.equal(displayed(view).saving, true);
  await view.update({ environmentId: "beta" });
  assert.equal(displayed(view).saving, false);
  await waitFor(() => assert.equal(displayed(view).state, "ready"));
  await press(view, "Toggle");
  assert.equal(displayed(view).saving, true);
  await act(async () => alphaWrite.resolve());
  assert.equal(displayed(view).saving, true);
  await act(async () => betaWrite.resolve());
  await waitFor(() => assert.equal(displayed(view).saving, false));
});

test("settings with unavailable codemode do not issue writes", async (t) => {
  const unavailable = {
    ...defaults,
    availability: { available: false, reason: "missing_sandbox" },
  };
  let writes = 0;
  host(
    t,
    "alpha",
    () => unavailable,
    () => {
      writes += 1;
      return unavailable;
    },
  );
  const view = await mount(t, Controls);
  await waitFor(() => assert.equal(displayed(view).state, "ready"));
  await press(view, "Toggle");
  await press(view, "Only");
  assert.equal(writes, 0);
  assert.deepEqual(displayed(view).settings, unavailable);
  assert.equal(displayed(view).saving, false);
});

test("a retained callback cannot save after a new environment has rendered before its effects run", async (t) => {
  let writes = 0;
  host(
    t,
    "alpha",
    () => defaults,
    () => {
      writes += 1;
      return defaults;
    },
  );
  host(t, "beta", () => defaults);
  let oldController;
  let staleAttempt;
  const onRender = (controller) => {
    if (controller.state === "ready" && !oldController) oldController = controller;
    if (oldController && controller.state === "loading" && !staleAttempt)
      staleAttempt = oldController.toggleEnabled(false);
  };
  const view = await mount(t, Controls, { environmentId: "alpha", onRender });
  await waitFor(() => assert.ok(oldController));
  await view.update({ environmentId: "beta", onRender });
  assert.ok(staleAttempt);
  await staleAttempt;
  assert.equal(writes, 0);
  await waitFor(() => assert.equal(displayed(view).state, "ready"));
});

test("two synchronous edits issue one write and the guard reopens after completion", async (t) => {
  const pending = [];
  host(
    t,
    "alpha",
    () => defaults,
    (patch) => {
      const reply = createDeferred();
      pending.push({ patch, reply });
      return reply.promise;
    },
  );
  const view = await mount(t, Controls);
  await waitFor(() => assert.equal(displayed(view).state, "ready"));
  await press(view, "Burst");
  await waitFor(() => assert.equal(pending.length, 1));
  assert.deepEqual(pending[0].patch, { enabled: false });
  assert.equal(displayed(view).settings.mode, "on");
  await act(async () => pending[0].reply.resolve({ ...defaults, enabled: false }));
  await waitFor(() => assert.equal(displayed(view).saving, false));
  await press(view, "Only");
  await waitFor(() => assert.equal(pending.length, 2));
  assert.deepEqual(pending[1].patch, { mode: "only" });
  await act(async () => pending[1].reply.resolve({ ...defaults, enabled: false, mode: "only" }));
  await waitFor(() => assert.equal(displayed(view).saving, false));
  assert.equal(displayed(view).settings.mode, "only");
});

test("old save failures do not leak into a new A after switching A to B to A", async (t) => {
  const response = createDeferred();
  host(
    t,
    "alpha",
    () => defaults,
    () => response.promise,
  );
  host(t, "beta", () => ({ ...defaults, mode: "only" }));
  const view = await mount(t, Controls, { environmentId: "alpha" });
  await waitFor(() => assert.equal(displayed(view).state, "ready"));
  await press(view, "Toggle");
  await view.update({ environmentId: "beta" });
  await view.update({ environmentId: "alpha" });
  await act(async () => response.reject(new Error("Old save failed")));
  await waitFor(() => assert.equal(displayed(view).state, "ready"));
  assert.deepEqual(displayed(view), { state: "ready", settings: defaults, saving: false, errorMessage: null });
});

test("the controller exposes load errors and unsupported states without allowing writes, and can retry", async (t) => {
  let fail = true;
  let writes = 0;
  host(
    t,
    "alpha",
    () => {
      if (fail) throw new api.RpcError({ code: "METHOD_NOT_FOUND", message: "Unknown method" });
      return defaults;
    },
    () => {
      writes += 1;
      return defaults;
    },
  );
  const view = await mount(t, Controls);
  await waitFor(() => assert.equal(displayed(view).state, "unsupported"));
  await press(view, "Toggle");
  await press(view, "Only");
  assert.equal(writes, 0);
  assert.equal(displayed(view).settings, null);
  host(t, "beta", () => {
    throw new Error("Cannot read settings");
  });
  await view.update({ environmentId: "beta" });
  await waitFor(() => assert.equal(displayed(view).state, "error"));
  assert.equal(displayed(view).errorMessage, "Cannot read settings");
  assert.equal(displayed(view).settings, null);
  fail = false;
  await view.update({ environmentId: "alpha" });
  await press(view, "Reload");
  await waitFor(() => assert.equal(displayed(view).state, "ready"));
});

test("an unmounted controller discards save completion and a new owner reads the saved global settings", async (t) => {
  const write = createDeferred();
  let enabled = true;
  host(
    t,
    "alpha",
    () => ({ ...defaults, enabled }),
    () =>
      write.promise.then(() => {
        enabled = false;
        return { ...defaults, enabled };
      }),
  );
  const rendered = [];
  const view = await mount(t, Controls, { onRender: (controller) => rendered.push(controller.state) });
  await waitFor(() => assert.equal(displayed(view).state, "ready"));
  await press(view, "Toggle");
  await view.unmount();
  const count = rendered.length;
  await act(async () => write.resolve());
  assert.equal(rendered.length, count);
  const next = await mount(t, Controls);
  await waitFor(() => assert.equal(displayed(next).settings?.enabled, false));
  assert.equal(displayed(next).saving, false);
});
