import assert from "node:assert/strict";
import test from "node:test";
import { importTestBundle } from "#test-bundle";
const { WorkspaceStore, projectKeyOf } = await importTestBundle("workspace-store-public", {
  stdin: {
    contents:
      'export { WorkspaceStore } from "./src/renderer/lib/workspace-store.ts"; export { projectKeyOf } from "./src/shared/project-space-state.ts";',
    resolveDir: process.cwd(),
    loader: "ts",
  },
  tsconfig: "tsconfig.renderer.json",
  packages: "external",
});
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
