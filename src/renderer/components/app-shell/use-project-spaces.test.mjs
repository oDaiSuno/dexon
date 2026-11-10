import assert from "node:assert/strict";
import test from "node:test";
import { deferred, remoteServer } from "../remote-folder-picker/folder-browser-test-helpers.mjs";
import { api, mountProjectProbe } from "./project-spaces-test-harness.mjs";

const spaceProps = { defaultSpace: null, currentProject: null, refreshKey: 0, onCloseCurrent() {} };
const primaryServer = (generation) => ({
  ...remoteServer("primary", { phase: "connected", generation, since: generation * 1000 }),
  target: { kind: "primary" },
});

test("a CLOSED primary probe preserves presence and a new generation validates the directory again", async (t) => {
  const pending = deferred();
  const host = await mountProjectProbe(t, (props) => api.useProjectSpaces(props), {
    servers: [primaryServer(1)],
    props: spaceProps,
    reply: (_id, method) => (method === "host.ping" ? { ok: true } : pending.promise),
  });
  const bridge = globalThis.window.piBridge;
  bridge.getHostStatus = async () => "ready";
  bridge.requestHostPort = () => bridge.requestEnvironmentPort("primary");
  await host.run(({ workspaceStore }) =>
    workspaceStore.noteCurrentProject({ environmentId: "primary", path: "/work/app" }, null),
  );
  const validationCount = () => host.requests.filter((request) => request.method === "system.validateCwd").length;
  assert.equal(validationCount(), 1);
  await host.run(() => api.resetRpc());
  assert.equal(host.get().isMissing("/work/app"), false, "a closed connection cannot prove a directory is missing");
  pending.resolve({ ok: true, path: "/work/app" });
  host.setReply(() => ({ ok: false, reason: "missing", error: "Directory does not exist" }));
  await host.changeServers([primaryServer(2)]);
  assert.equal(validationCount(), 2, "the next primary generation must revalidate without a manual refresh");
  assert.equal(host.get().isMissing("/work/app"), true);
  host.setReply(() => ({ ok: true, path: "/work/app" }));
  await host.changeServers([primaryServer(3)]);
  assert.equal(validationCount(), 3);
  assert.equal(host.get().isMissing("/work/app"), false);
});

test("deployment progress elsewhere does not repeatedly reauthorize an unchanged mounted project", async (t) => {
  const gpu = remoteServer("gpu");
  const deploying = (progress) =>
    remoteServer("staging", { phase: "connecting", stage: "deploying", attempt: 1, progress });
  const host = await mountProjectProbe(t, (props) => api.useProjectSpaces(props), {
    servers: [gpu, deploying(0.1)],
    props: spaceProps,
    reply: (_id, method, params) => {
      assert.equal(method, "system.validateCwd");
      return { ok: true, path: params.path };
    },
  });
  await host.run(({ workspaceStore }) =>
    workspaceStore.noteCurrentProject({ environmentId: "gpu", path: "/work/empty" }, null),
  );
  const validationCount = () => host.requests.filter((request) => request.method === "system.validateCwd").length;
  assert.equal(validationCount(), 1);
  await host.changeServers([{ ...gpu }, deploying(0.5)]);
  await host.changeServers([{ ...gpu }, deploying(0.9)]);
  assert.equal(validationCount(), 1, "progress updates must not reauthorize an unchanged connection generation");
});

test("moving or dragging unchanged mounted projects does not repeat root authorization", async (t) => {
  const host = await mountProjectProbe(t, (props) => api.useProjectSpaces(props), {
    servers: [remoteServer("gpu"), remoteServer("staging")],
    props: spaceProps,
    reply: (_id, _method, params) => ({ ok: true, path: params.path }),
  });
  await host.run(({ workspaceStore }) => {
    workspaceStore.noteCurrentProject({ environmentId: "gpu", path: "/work/app" }, null);
    workspaceStore.noteCurrentProject({ environmentId: "staging", path: "/work/app" }, null);
  });
  const validationCount = () => host.requests.filter((request) => request.method === "system.validateCwd").length;
  assert.equal(validationCount(), 2);
  await host.run(() => host.get().move("/work/app", -1, "gpu"));
  assert.deepEqual(
    host.get().spaces.map((space) => space.environmentId),
    ["gpu", "staging"],
  );
  assert.equal(validationCount(), 2, "menu movement changes order, not the authorized roots");
  await host.run(() => host.get().reorder(1, 0));
  assert.deepEqual(
    host.get().spaces.map((space) => space.environmentId),
    ["staging", "gpu"],
  );
  assert.equal(validationCount(), 2, "dragging changes order, not the authorized roots");
});

test("empty remote mounts are reauthorized after refresh and every new connected generation, not while offline", async (t) => {
  let exists = false;
  const host = await mountProjectProbe(t, (props) => api.useProjectSpaces(props), {
    servers: [remoteServer("gpu")],
    props: spaceProps,
    reply: (_id, method, params) => {
      assert.equal(method, "system.validateCwd");
      return { ok: exists, path: params.path };
    },
  });
  await host.run(({ workspaceStore }) =>
    workspaceStore.noteCurrentProject({ environmentId: "gpu", path: "/work/empty" }, null),
  );
  assert.equal(host.get().isMissing("/work/empty", "gpu"), true);
  exists = true;
  await host.update({ ...spaceProps, refreshKey: 1 });
  assert.equal(host.get().isMissing("/work/empty", "gpu"), false);
  const beforeDisconnect = host.requests.length;
  await host.changeServers([
    remoteServer("gpu", { phase: "backoff", reason: "network", detail: "lost", retryAt: 1000, failureCount: 1 }),
  ]);
  assert.equal(host.requests.length, beforeDisconnect);
  assert.equal(host.get().isMissing("/work/empty", "gpu"), false);
  await host.changeServers([remoteServer("gpu", { phase: "connected", generation: 2, since: 2000 })]);
  assert.equal(host.requests.length, beforeDisconnect + 1);
  assert.deepEqual(host.requests.at(-1), {
    environmentId: "gpu",
    method: "system.validateCwd",
    params: { path: "/work/empty" },
  });
});

test("health, order and removal keep identical paths on different servers separate and never delete sessions", async (t) => {
  const host = await mountProjectProbe(t, (props) => api.useProjectSpaces(props), {
    servers: [remoteServer("gpu"), remoteServer("staging")],
    props: spaceProps,
    reply: (id, _method, params) => ({ ok: id !== "gpu", path: params.path }),
  });
  await host.run(({ workspaceStore }) => {
    workspaceStore.noteCurrentProject({ environmentId: "gpu", path: "/work/app" }, null);
    workspaceStore.noteCurrentProject({ environmentId: "staging", path: "/work/app" }, null);
  });
  assert.equal(host.get().isMissing("/work/app", "gpu"), true);
  assert.equal(host.get().isMissing("/work/app", "staging"), false);
  assert.deepEqual(
    host.get().spaces.map((space) => space.environmentId),
    ["staging", "gpu"],
  );
  await host.run(() => host.get().move("/work/app", -1, "gpu"));
  assert.deepEqual(
    host.get().spaces.map((space) => space.environmentId),
    ["gpu", "staging"],
  );
  await host.run(() => host.get().close("/work/app", "gpu"));
  assert.deepEqual(
    host.get().spaces.map((space) => space.environmentId),
    ["staging"],
  );
  assert.equal(
    host.requests.some((request) => request.method === "sessions.delete"),
    false,
  );
  assert.deepEqual(
    host.writes.at(-1).projectSpaces.spaces.map((space) => space.environmentId),
    ["staging"],
  );
});

test("a saved space whose server is absent cannot displace the mounted rows during move or drag", async (t) => {
  const host = await mountProjectProbe(t, (props) => api.useProjectSpaces(props), {
    servers: [remoteServer("gpu"), remoteServer("staging")],
    props: spaceProps,
    reply: (_id, _method, params) => ({ ok: true, path: params.path }),
  });
  await host.run(({ workspaceStore }) => {
    workspaceStore.noteCurrentProject({ environmentId: "staging", path: "/work/app" }, null);
    workspaceStore.noteCurrentProject({ environmentId: "absent", path: "/work/app" }, null);
    workspaceStore.noteCurrentProject({ environmentId: "gpu", path: "/work/app" }, null);
  });
  assert.deepEqual(
    host.get().spaces.map((space) => space.environmentId),
    ["gpu", "staging"],
  );
  await host.run(() => host.get().move("/work/app", 1, "gpu"));
  assert.deepEqual(
    host.get().spaces.map((space) => space.environmentId),
    ["staging", "gpu"],
  );
  await host.run(() => host.get().reorder(1, 0));
  assert.deepEqual(
    host.get().spaces.map((space) => space.environmentId),
    ["gpu", "staging"],
  );
});

for (const reason of ["denied", "io-error"]) {
  test(`a primary ${reason} answer preserves the last confirmed presence until the next connected generation`, async (t) => {
    const host = await mountProjectProbe(t, (props) => api.useProjectSpaces(props), {
      servers: [primaryServer(1)],
      props: spaceProps,
      reply: () => ({ ok: false, reason, error: "Directory unavailable" }),
    });
    const bridge = globalThis.window.piBridge;
    bridge.requestHostPort = () => bridge.requestEnvironmentPort("primary");
    await host.run(({ workspaceStore }) =>
      workspaceStore.noteCurrentProject({ environmentId: "primary", path: "/work/app" }, null),
    );
    assert.equal(host.get().isMissing("/work/app"), false);
    host.setReply(() => ({ ok: false, reason: "not-directory", error: "Not a directory" }));
    await host.changeServers([primaryServer(2)]);
    assert.equal(host.get().isMissing("/work/app"), true);
    host.setReply(() => ({ ok: false, reason, error: "Directory unavailable" }));
    await host.changeServers([primaryServer(3)]);
    assert.equal(
      host.get().isMissing("/work/app"),
      true,
      "an unknown answer must not erase a confirmed missing result",
    );
    const beforeOffline = host.requests.length;
    await host.changeServers([{ ...primaryServer(3), status: { phase: "offline", lastFailure: null } }]);
    assert.equal(host.requests.length, beforeOffline, "an offline primary cannot authorize a directory");
    host.setReply(() => ({ ok: true, path: "/work/app" }));
    await host.changeServers([primaryServer(4)]);
    assert.equal(host.get().isMissing("/work/app"), false);
  });
}
