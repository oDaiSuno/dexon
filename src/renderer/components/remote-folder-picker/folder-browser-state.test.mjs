import assert from "node:assert/strict";
import test from "node:test";
import { importTestBundle } from "#test-bundle";

const { createFolderBrowserState, folderBrowserReducer, folderMountTarget } = await importTestBundle(
  "folder-browser-state",
  {
    entryPoints: ["src/renderer/components/remote-folder-picker/folder-browser-state.ts"],
    tsconfig: "tsconfig.renderer.json",
    packages: "external",
  },
);

export function server(id, status = { phase: "connected", generation: 1, since: 0 }) {
  return { id, label: id, enabled: true, target: { kind: "ssh", sshAlias: id }, status, descriptor: null };
}

export function listing(path, overrides = {}) {
  return {
    ok: true,
    path,
    displayPath: path.replace("/home/dev", "~"),
    home: "/home/dev",
    parent: path === "/" ? null : path.slice(0, path.lastIndexOf("/")) || "/",
    git: null,
    folders: [],
    truncated: false,
    ...overrides,
  };
}

function complete(state, result) {
  return folderBrowserReducer(state, { type: "completed", request: state.request, listing: result });
}

test("opening the picker browses the explicitly chosen server home without offering an unverified mount", () => {
  const state = createFolderBrowserState([server("gpu"), server("staging")], "staging");
  assert.equal(state.kind, "loading");
  assert.equal(state.targetEnvironmentId, "staging");
  assert.equal(state.request.path, "~");
  assert.equal(folderMountTarget(state, [server("gpu"), server("staging")]), null);
  const ready = complete(state, listing("/home/dev"));
  assert.deepEqual(folderMountTarget(ready, [server("staging")]), {
    environmentId: "staging",
    path: "/home/dev",
    displayPath: "~",
  });
});

test("changing servers reopens home and never accepts the previous server response", () => {
  const first = createFolderBrowserState([server("gpu")]);
  const next = folderBrowserReducer(first, { type: "select-server", server: server("staging") });
  assert.equal(next.targetEnvironmentId, "staging");
  assert.equal(next.request.path, "~");
  assert.equal(folderMountTarget(next, [server("staging")]), null);
  const stale = folderBrowserReducer(next, {
    type: "completed",
    request: first.request,
    listing: listing("/old-server"),
  });
  assert.equal(stale.kind, "loading");
  assert.deepEqual(folderMountTarget(complete(stale, listing("/new-server")), [server("staging")]), {
    environmentId: "staging",
    path: "/new-server",
    displayPath: "/new-server",
  });
});

test("a newer path disables mounting immediately and discards an older path completion", () => {
  const ready = complete(createFolderBrowserState([server("gpu")]), listing("/home/dev"));
  const first = folderBrowserReducer(ready, { type: "open-path", path: "~/old" });
  assert.equal(first.kind, "loading");
  assert.equal(folderMountTarget(first, [server("gpu")]), null);
  const next = folderBrowserReducer(first, { type: "open-path", path: "~/current" });
  const stale = folderBrowserReducer(next, {
    type: "completed",
    request: first.request,
    listing: listing("/home/dev/old"),
  });
  assert.equal(stale.kind, "loading");
  assert.deepEqual(
    folderMountTarget(
      complete(
        stale,
        listing("/canonical/current", {
          displayPath: "~/current",
        }),
      ),
      [server("gpu")],
    ),
    {
      environmentId: "gpu",
      path: "/canonical/current",
      displayPath: "~/current",
    },
  );
});

test("the local environment is not a remote server and adding the first remote starts its home listing", () => {
  const primary = { ...server("primary"), target: { kind: "primary" } };
  const empty = createFolderBrowserState([primary]);
  assert.equal(empty.kind, "no-servers");
  assert.equal(folderMountTarget(empty, [primary]), null);
  const first = folderBrowserReducer(empty, { type: "servers-changed", servers: [primary, server("gpu")] });
  assert.equal(first.kind, "loading");
  assert.equal(first.targetEnvironmentId, "gpu");
  assert.equal(first.request.path, "~");
  const removed = folderBrowserReducer(first, { type: "servers-changed", servers: [primary] });
  assert.equal(removed.kind, "no-servers");
  assert.equal(folderMountTarget(removed, [primary]), null);
});

test("losing a connection invalidates an in-flight listing and a prior ready mount until the new generation loads", () => {
  const connected = server("gpu");
  const offline = server("gpu", { phase: "offline", lastFailure: null });
  const loading = createFolderBrowserState([connected]);
  const ready = complete(loading, listing("/home/dev"));
  assert.equal(folderMountTarget(ready, [offline]), null);
  const lost = folderBrowserReducer(loading, { type: "servers-changed", servers: [offline] });
  assert.equal(lost.kind, "server-unavailable");
  assert.equal(
    folderBrowserReducer(lost, {
      type: "completed",
      request: loading.request,
      listing: listing("/stale"),
    }).kind,
    "server-unavailable",
  );
  const reconnect = server("gpu", { phase: "connected", generation: 2, since: 10 });
  assert.equal(folderMountTarget(ready, [reconnect]), null);
  const fresh = folderBrowserReducer(lost, { type: "servers-changed", servers: [reconnect] });
  assert.equal(fresh.kind, "loading");
  assert.equal(fresh.request.path, "~");
  assert.equal(folderMountTarget(fresh, [reconnect]), null);
  assert.equal(folderMountTarget(complete(fresh, listing("/fresh")), [reconnect]).path, "/fresh");
});

test("a rejected path or failed browse request keeps its error visible and never falls back to the old mount", () => {
  const ready = complete(createFolderBrowserState([server("gpu")]), listing("/home/dev"));
  for (const code of ["not-absolute", "not-found", "not-directory", "permission-denied"]) {
    const loading = folderBrowserReducer(ready, { type: "open-path", path: "/restricted" });
    const error = complete(loading, { ok: false, path: "/restricted", error: code });
    assert.equal(error.kind, "path-error");
    assert.deepEqual(error.error, { kind: "path", code });
    assert.equal(error.path, "/restricted");
    assert.equal(folderMountTarget(error, [server("gpu")]), null);
  }
  const loading = folderBrowserReducer(ready, { type: "open-path", path: "/timeout" });
  const error = folderBrowserReducer(loading, { type: "failed", request: loading.request, message: "RPC timeout" });
  assert.equal(error.kind, "path-error");
  assert.deepEqual(error.error, { kind: "request", message: "RPC timeout" });
  assert.equal(folderMountTarget(error, [server("gpu")]), null);
});

test("a mistyped navigation path retains both previous folder lists without permitting an old mount", () => {
  const workspace = { name: "workspace", path: "/home/dev/workspace", displayPath: "~/workspace", git: null };
  const app = { name: "app", path: "/home/dev/workspace/app", displayPath: "~/workspace/app", git: null };
  const home = complete(createFolderBrowserState([server("gpu")]), listing("/home/dev", { folders: [workspace] }));
  const ready = complete(
    folderBrowserReducer(home, { type: "select-child", entry: workspace }),
    listing("/home/dev/workspace", { folders: [app] }),
  );
  const loading = folderBrowserReducer(ready, { type: "open-path", path: "~/workspcae" });
  assert.equal(folderMountTarget(loading, [server("gpu")]), null);
  const error = complete(loading, { ok: false, path: "~/workspcae", error: "not-found" });
  assert.equal(error.kind, "path-error");
  assert.equal(error.path, "~/workspcae");
  assert.deepEqual(
    error.base?.folders.map((entry) => entry.name),
    ["workspace"],
  );
  assert.deepEqual(
    error.preview?.folders.map((entry) => entry.name),
    ["app"],
  );
  assert.equal(folderMountTarget(error, [server("gpu")]), null);
  assert.equal(loading.base?.displayPath, "~");
  assert.equal(loading.preview?.displayPath, "~/workspace");
  const retry = folderBrowserReducer(error, { type: "open-path", path: "~/workspcae" });
  const disconnected = folderBrowserReducer(retry, { type: "failed", request: retry.request, message: "RPC timeout" });
  assert.deepEqual(
    disconnected.base?.folders.map((entry) => entry.name),
    ["workspace"],
  );
  assert.deepEqual(
    disconnected.preview?.folders.map((entry) => entry.name),
    ["app"],
  );
  assert.equal(folderMountTarget(disconnected, [server("gpu")]), null);
});

test("selecting a child preserves its parent column and branch badge while verifying an empty folder for mounting", () => {
  const entry = { name: "app", path: "/canonical/app", displayPath: "~/app", git: { branch: "main", detached: false } };
  const home = listing("/home/dev", { folders: [entry] });
  const ready = complete(createFolderBrowserState([server("gpu")]), home);
  const selected = folderBrowserReducer(ready, { type: "select-child", entry });
  assert.equal(selected.kind, "loading");
  assert.deepEqual(selected.base, home);
  assert.deepEqual(selected.selectedChild.git, { branch: "main", detached: false });
  assert.equal(selected.request.path, "~/app");
  assert.equal(folderMountTarget(selected, [server("gpu")]), null);
  const empty = complete(selected, listing("/canonical/app", { displayPath: "~/app", git: entry.git }));
  assert.deepEqual(empty.base.folders, [entry]);
  assert.deepEqual(empty.current.listing.folders, []);
  assert.deepEqual(folderMountTarget(empty, [server("gpu")]), {
    environmentId: "gpu",
    path: "/canonical/app",
    displayPath: "~/app",
  });
});

test("available is usable only for the local environment and never authorizes remote browsing or mounting", () => {
  const availableRemote = server("gpu", { phase: "available" });
  const unavailable = createFolderBrowserState([availableRemote]);
  assert.equal(unavailable.kind, "server-unavailable");
  assert.equal(folderMountTarget(unavailable, [availableRemote]), null);
  const loading = createFolderBrowserState([server("gpu")]);
  const ready = complete(loading, listing("/home/dev"));
  assert.equal(folderMountTarget(ready, [availableRemote]), null);
  const changed = folderBrowserReducer(ready, { type: "servers-changed", servers: [availableRemote] });
  assert.equal(changed.kind, "server-unavailable");
});

test("selecting from the second column verifies the mount without advancing the base browsing root", () => {
  const workspace = { name: "workspace", path: "/home/dev/workspace", displayPath: "~/workspace", git: null };
  const app = {
    name: "app",
    path: "/srv/app",
    displayPath: "~/workspace/app",
    git: { branch: "main", detached: false },
  };
  const home = listing("/home/dev", { folders: [workspace] });
  const workspaceListing = listing("/home/dev/workspace", { folders: [app] });
  const ready = complete(createFolderBrowserState([server("gpu")]), home);
  const preview = complete(folderBrowserReducer(ready, { type: "select-child", entry: workspace }), workspaceListing);
  const selected = folderBrowserReducer(preview, { type: "select-child", entry: app });
  assert.equal(selected.base.path, "/home/dev", "a single click preserves the first folder column");
  assert.equal(folderMountTarget(selected, [server("gpu")]), null);
  const verified = complete(selected, listing("/srv/app", { displayPath: "~/workspace/app", git: app.git }));
  assert.equal(verified.base.path, "/home/dev", "selection completion does not navigate either");
  assert.deepEqual(folderMountTarget(verified, [server("gpu")]), {
    environmentId: "gpu",
    path: "/srv/app",
    displayPath: "~/workspace/app",
  });
  const opened = complete(
    folderBrowserReducer(verified, { type: "open-path", path: "~/workspace/app" }),
    listing("/srv/app", { displayPath: "~/workspace/app" }),
  );
  assert.equal(opened.base.path, "/srv/app", "only an explicit open advances the root");
});
