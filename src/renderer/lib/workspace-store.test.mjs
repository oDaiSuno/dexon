import assert from "node:assert/strict";
import test from "node:test";
import { MessageChannel } from "node:worker_threads";
import { importTestBundle } from "#test-bundle";
const { WorkspaceStore, projectKeyOf, getEnvironmentConnection, createRpcServer } = await importTestBundle(
  "workspace-store-public",
  {
    stdin: {
      contents:
        'export { WorkspaceStore } from "./src/renderer/lib/workspace-store.ts"; export { projectKeyOf } from "./src/shared/project-space-state.ts"; export { getEnvironmentConnection } from "./src/renderer/lib/environment-registry.ts"; export { createRpcServer } from "./src/contract/rpc.ts";',
      resolveDir: process.cwd(),
      loader: "ts",
    },
    tsconfig: "tsconfig.renderer.json",
    packages: "external",
  },
);
const bridgeFor = (state, writes = []) => ({
  getUiState: async () => structuredClone(state),
  listEnvironments: async () => ({
    revision: 1,
    policy: { detachedDaemon: true, autoReconnect: true },
    environments: [{ id: "gpu", enabled: true }],
  }),
  setUiState: async (patch) => {
    writes.push(structuredClone(patch));
  },
});

test("a server-scoped remembered space restores only when that server remains enabled", async () => {
  const remote = { environmentId: "gpu", path: "/code/app", displayPath: "~/app" };
  const state = { projectSpaces: { version: 2, spaces: [remote], seeded: ["gpu"], lastFocusedSpace: remote } };
  const store = new WorkspaceStore();
  await store.initialize(bridgeFor(state));
  assert.equal(store.getSnapshot().focus.environmentId, "gpu");
  assert.equal(store.getSnapshot().focus.spaceKey, projectKeyOf(remote));
  const offline = new WorkspaceStore();
  await offline.initialize({
    ...bridgeFor(state),
    listEnvironments: async () => ({ environments: [{ id: "gpu", enabled: false }] }),
  });
  assert.equal(offline.getSnapshot().focus.environmentId, "primary");
  assert.equal(offline.getSnapshot().spaces[0].path, "/code/app");
});

test("restore recovers valid remote spaces and focus when a saved sibling is malformed", async () => {
  const remote = { environmentId: "gpu", path: "/code/recoverable" };
  const store = new WorkspaceStore();
  await store.initialize(
    bridgeFor({
      openProjects: ["/code/legacy"],
      projectSpaces: {
        version: 2,
        spaces: [remote, { environmentId: "", path: "/code/invalid" }],
        seeded: ["gpu", null],
        lastFocusedSpace: remote,
      },
    }),
  );
  assert.deepEqual(
    store.getSnapshot().spaces.map(({ environmentId, path }) => ({ environmentId, path })),
    [{ environmentId: "gpu", path: "/code/recoverable" }],
  );
  assert.deepEqual(store.getSnapshot().seeded, ["gpu"]);
  assert.deepEqual(store.getSnapshot().focus, {
    environmentId: "gpu",
    spaceKey: '["gpu","/code/recoverable"]',
    sessionId: null,
  });
});

test("choosing a session while restore is pending does not erase mounted spaces or overwrite saved state early", async () => {
  let restore;
  const writes = [];
  const remote = { environmentId: "gpu", path: "/code/old" };
  const bridge = {
    ...bridgeFor({}, writes),
    getUiState: () =>
      new Promise((resolve) => {
        restore = resolve;
      }),
  };
  const store = new WorkspaceStore();
  const loading = store.initialize(bridge);
  store.focusSession({ id: "new-session", environmentId: "gpu", cwd: "/code/new" });
  assert.deepEqual(writes, []);
  restore({ projectSpaces: { version: 2, spaces: [remote], seeded: [] } });
  await loading;
  assert.equal(store.getSnapshot().spaces[0].path, "/code/old");
  assert.deepEqual(store.getSnapshot().focus, {
    environmentId: "gpu",
    spaceKey: '["gpu","/code/new"]',
    sessionId: "new-session",
  });
});

for (const failingMethod of ["getUiState", "listEnvironments"]) {
  for (const action of ["focusSession", "seedFromSessions"]) {
    test(`${action} after ${failingMethod} fails preserves saved spaces until the same bridge recovers`, async () => {
      const remote = { environmentId: "gpu", path: "/code/a", displayPath: "~/a" };
      const other = { environmentId: "other", path: "/code/b", displayPath: "/code/b" };
      const seeded = { environmentId: "new", path: "/code/c", displayPath: "/code/c" };
      const writes = [];
      const state = {
        projectSpaces: { version: 2, spaces: [remote, other], seeded: ["gpu"], lastFocusedSpace: remote },
      };
      const healthy = bridgeFor(state, writes);
      let failing = true;
      const bridge = {
        ...healthy,
        [failingMethod]: async () => {
          if (failing) throw new Error("Temporary bridge read failure");
          return healthy[failingMethod]();
        },
      };
      const store = new WorkspaceStore();
      await store.initialize(bridge);
      if (action === "focusSession") store.focusSession({ id: "chosen-session", environmentId: "gpu", cwd: "/code/a" });
      else store.seedFromSessions("new", ["/code/c"]);
      assert.deepEqual(writes, []);
      assert.equal(store.getSnapshot().loaded, false);
      failing = false;
      await store.initialize(bridge);
      assert.equal(store.getSnapshot().loaded, true);
      assert.deepEqual(
        store
          .getSnapshot()
          .spaces.map(({ environmentId, path, displayPath }) => ({ environmentId, path, displayPath })),
        action === "focusSession" ? [remote, other] : [seeded, remote, other],
      );
      assert.deepEqual(store.getSnapshot().seeded, action === "focusSession" ? ["gpu"] : ["gpu", "new"]);
      assert.deepEqual(store.getSnapshot().focus, {
        environmentId: "gpu",
        spaceKey: '["gpu","/code/a"]',
        sessionId: action === "focusSession" ? "chosen-session" : null,
      });
      assert.deepEqual(writes.at(-1), {
        projectSpaces: {
          version: 2,
          spaces: action === "focusSession" ? [remote, other] : [seeded, remote, other],
          seeded: action === "focusSession" ? ["gpu"] : ["gpu", "new"],
          lastFocusedSpace: remote,
        },
      });
    });
  }
}

for (const removal of ["space", "environment"]) {
  test(`removing ${removal} during restore preserves and persists unrelated saved spaces`, async () => {
    const remote = { environmentId: "gpu", path: "/code/a" };
    const other = { environmentId: "other", path: "/code/b" };
    const pending = Promise.withResolvers();
    const writes = [];
    const store = new WorkspaceStore();
    const loading = store.initialize({ ...bridgeFor({}, writes), getUiState: () => pending.promise });
    if (removal === "space") store.unmount(projectKeyOf(remote));
    else store.unmountEnvironment("gpu");
    assert.deepEqual(writes, []);
    pending.resolve({
      theme: "dark",
      projectSpaces: { version: 2, spaces: [remote, other], seeded: ["gpu", "other"], lastFocusedSpace: remote },
    });
    await loading;
    assert.deepEqual(
      store.getSnapshot().spaces.map(({ environmentId, path }) => ({ environmentId, path })),
      [{ environmentId: "other", path: "/code/b" }],
    );
    assert.deepEqual(store.getSnapshot().seeded, ["gpu", "other"]);
    assert.deepEqual(store.getSnapshot().focus, { environmentId: "primary", spaceKey: null, sessionId: null });
    assert.deepEqual(writes.at(-1), {
      projectSpaces: {
        version: 2,
        spaces: [{ environmentId: "other", path: "/code/b", displayPath: "/code/b" }],
        seeded: ["gpu", "other"],
        lastFocusedSpace: null,
      },
    });
  });
}

test("an unrelated session chosen during restore survives a pending environment removal", async () => {
  const remote = { environmentId: "gpu", path: "/code/a" };
  const other = { environmentId: "other", path: "/code/b" };
  const pending = Promise.withResolvers();
  const store = new WorkspaceStore();
  const loading = store.initialize({ ...bridgeFor({}), getUiState: () => pending.promise });
  store.unmountEnvironment("gpu");
  store.focusSession({ id: "new-session", environmentId: "other", cwd: "/code/new" });
  pending.resolve({
    projectSpaces: { version: 2, spaces: [remote, other], seeded: [], lastFocusedSpace: remote },
  });
  await loading;
  assert.deepEqual(store.getSnapshot().focus, {
    environmentId: "other",
    spaceKey: '["other","/code/new"]',
    sessionId: "new-session",
  });
  assert.deepEqual(
    store.getSnapshot().spaces.map(({ environmentId, path }) => ({ environmentId, path })),
    [{ environmentId: "other", path: "/code/b" }],
  );
});

for (const removed of ["primary", "other"]) {
  test(`restore does not preserve focus on explicitly removed ${removed}`, async () => {
    const remote = { environmentId: "gpu", path: "/code/a" };
    const pending = Promise.withResolvers();
    const store = new WorkspaceStore();
    const loading = store.initialize({ ...bridgeFor({}), getUiState: () => pending.promise });
    store.unmountEnvironment(removed);
    if (removed === "other") store.focusSession({ id: "removed-session", environmentId: "other", cwd: "/code/b" });
    pending.resolve({
      projectSpaces: { version: 2, spaces: [remote], seeded: [], lastFocusedSpace: remote },
    });
    await loading;
    assert.deepEqual(store.getSnapshot().focus, {
      environmentId: "gpu",
      spaceKey: '["gpu","/code/a"]',
      sessionId: null,
    });
  });
}

test("pending space operations replay in order without repeating saved session seeding", async () => {
  const remote = { environmentId: "gpu", path: "/code/a" };
  const other = { environmentId: "other", path: "/code/b" };
  const extra = { environmentId: "new", path: "/code/c" };
  const pending = Promise.withResolvers();
  const store = new WorkspaceStore();
  const loading = store.initialize({ ...bridgeFor({}), getUiState: () => pending.promise });
  store.unmount(projectKeyOf(remote));
  store.noteCurrentProject(extra, null);
  store.seedFromSessions("other", ["/code/removed-before-restart"]);
  store.move(projectKeyOf(other), -1, null);
  pending.resolve({ projectSpaces: { version: 2, spaces: [remote, other], seeded: ["other"] } });
  await loading;
  assert.deepEqual(
    store.getSnapshot().spaces.map(({ environmentId, path }) => ({ environmentId, path })),
    [
      { environmentId: "other", path: "/code/b" },
      { environmentId: "new", path: "/code/c" },
    ],
  );
  assert.deepEqual(store.getSnapshot().seeded, ["other"]);
});

test("a replacement bridge discards pending operations and ignores the retired restore", async () => {
  const remote = { environmentId: "gpu", path: "/code/a" };
  const pending = Promise.withResolvers();
  const store = new WorkspaceStore();
  const retired = store.initialize({ ...bridgeFor({}), getUiState: () => pending.promise });
  store.unmountEnvironment("gpu");
  await store.initialize(bridgeFor({ projectSpaces: { version: 2, spaces: [remote], seeded: ["gpu"] } }));
  pending.resolve({ projectSpaces: { version: 2, spaces: [], seeded: [] } });
  await retired;
  assert.deepEqual(
    store.getSnapshot().spaces.map(({ environmentId, path }) => ({ environmentId, path })),
    [{ environmentId: "gpu", path: "/code/a" }],
  );
  assert.deepEqual(store.getSnapshot().seeded, ["gpu"]);
});

test("seeding happens once and never remounts a project the user removed", async () => {
  const store = new WorkspaceStore();
  await store.initialize(bridgeFor({}));
  store.seedFromSessions("gpu", ["/code/a", "/code/a", "/code/b"]);
  assert.deepEqual(
    store.getSnapshot().spaces.map((space) => space.path),
    ["/code/a", "/code/b"],
  );
  store.unmount(projectKeyOf({ environmentId: "gpu", path: "/code/a" }));
  store.seedFromSessions("gpu", ["/code/a", "/code/c"]);
  assert.deepEqual(
    store.getSnapshot().spaces.map((space) => space.path),
    ["/code/b"],
  );
  assert.deepEqual(store.getSnapshot().seeded, ["gpu"]);
});

test("equal paths on two servers remain distinct through focus, ordering and environment removal", async () => {
  const store = new WorkspaceStore();
  await store.initialize(bridgeFor({}));
  const a = { environmentId: "gpu", path: "/code/app" },
    b = { environmentId: "other", path: "/code/app" };
  store.noteCurrentProject(a, null);
  store.noteCurrentProject(b, null);
  store.openSpace(a);
  assert.equal(store.getSnapshot().spaces.length, 2);
  assert.notEqual(projectKeyOf(a), projectKeyOf(b));
  store.move(projectKeyOf(a), -1, null);
  assert.equal(store.getSnapshot().spaces[0].environmentId, "gpu");
  store.unmountEnvironment("other");
  assert.equal(store.getSnapshot().focus.environmentId, "gpu");
  store.unmountEnvironment("gpu");
  assert.equal(store.getSnapshot().focus.environmentId, "primary");
  assert.equal(store.getSnapshot().spaces.length, 0);
});

test("a full sidebar rejects a new mount without changing the current workspace", async (t) => {
  const spaces = Array.from({ length: 200 }, (_, index) => ({ environmentId: "gpu", path: `/code/${index}` }));
  const writes = [];
  const store = new WorkspaceStore();
  await store.initialize(bridgeFor({ projectSpaces: { version: 2, spaces, seeded: [] } }, writes));
  store.openSpace(spaces[0]);
  const before = store.getSnapshot();
  const server = createRpcServer();
  server.handle({ "system.validateCwd": ({ path }) => ({ ok: true, path }) });
  const { port1, port2 } = new MessageChannel();
  server.attachPort(port1);
  const connection = getEnvironmentConnection("gpu");
  connection.replacePort(port2);
  t.after(() => {
    connection.close();
    server.detachPort(port1);
  });
  const previousWrites = writes.length;
  assert.equal(await store.mountAndOpen({ environmentId: "gpu", path: "/code/new" }), "invalid");
  assert.deepEqual(store.getSnapshot(), before);
  assert.equal(writes.length, previousWrites);
});
