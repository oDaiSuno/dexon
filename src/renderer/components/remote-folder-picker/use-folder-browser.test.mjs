import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { importTestBundle } from "#test-bundle";
import { mountFolderBrowser, remoteServer, folderListing, deferred } from "./folder-browser-test-helpers.mjs";

const api = await importTestBundle("use-folder-browser", {
  stdin: {
    contents: `export { useFolderBrowser } from "./src/renderer/components/remote-folder-picker/use-folder-browser.ts";
      export { workspaceStore } from "./src/renderer/lib/workspace-store.ts";
      export { environmentRegistry } from "./src/renderer/lib/environment-registry.ts";`,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  tsconfig: "tsconfig.renderer.json",
  packages: "external",
});

test("browsing and selecting another server use that server RPC without changing the actual workspace focus or persisted state", async (t) => {
  const host = await mountFolderBrowser(t, api, { initialEnvironmentId: "staging" });
  const before = structuredClone(api.workspaceStore.getSnapshot());
  assert.equal(host.get().state.kind, "ready");
  assert.deepEqual(host.get().mountTarget(), { environmentId: "staging", path: "/home/dev", displayPath: "~" });
  await act(async () => {
    host.get().openPath("/remote/project");
  });
  assert.equal(host.get().mountTarget().path, "/remote/project");
  await act(async () => {
    host.get().selectServer("gpu");
  });
  assert.equal(host.get().state.targetEnvironmentId, "gpu");
  assert.deepEqual(host.requests, [
    { environmentId: "staging", method: "projects.browse", params: { path: "~" } },
    { environmentId: "staging", method: "projects.browse", params: { path: "/remote/project" } },
    { environmentId: "gpu", method: "projects.browse", params: { path: "~" } },
  ]);
  assert.deepEqual(api.workspaceStore.getSnapshot(), before);
  assert.equal(api.workspaceStore.getSnapshot().focus.sessionId, "open-chat");
  assert.deepEqual(host.writes, []);
});

test("an obsolete server or path request cannot replace the latest ready selection at the hook boundary", async (t) => {
  const oldServer = deferred();
  const host = await mountFolderBrowser(t, api, {
    initialEnvironmentId: "gpu",
    reply: (id, _method, params) =>
      id === "gpu" ? oldServer.promise : folderListing(params.path === "~" ? "/staging/home" : params.path),
  });
  assert.equal(host.get().state.kind, "loading");
  await act(async () => {
    host.get().selectServer("staging");
    assert.equal(host.get().mountTarget(), null);
  });
  await act(async () => {
    oldServer.resolve(folderListing("/obsolete"));
  });
  assert.equal(host.get().mountTarget().path, "/staging/home");
  const oldPath = deferred();
  host.setReply((_id, _method, params) => (params.path === "/old" ? oldPath.promise : folderListing(params.path)));
  await act(async () => {
    host.get().openPath("/old");
    assert.equal(host.get().mountTarget(), null);
  });
  await act(async () => {
    host.get().openPath("/latest");
  });
  await act(async () => {
    oldPath.resolve(folderListing("/old"));
  });
  assert.deepEqual(host.get().mountTarget(), { environmentId: "staging", path: "/latest", displayPath: "/latest" });
  assert.equal(api.workspaceStore.getSnapshot().focus.sessionId, "open-chat");
  assert.deepEqual(host.writes, []);
});

test("connection loss during loading stays unmountable and reconnecting reloads home before offering a target", async (t) => {
  const pending = deferred();
  const host = await mountFolderBrowser(t, api, { servers: [remoteServer("gpu")], reply: () => pending.promise });
  await host.changeServers([remoteServer("gpu", { phase: "offline", lastFailure: null })]);
  await act(async () => {
    pending.resolve(folderListing("/stale"));
  });
  assert.equal(host.get().state.kind, "server-unavailable");
  assert.equal(host.get().mountTarget(), null);
  host.setReply(() => folderListing("/fresh/home"));
  await host.changeServers([remoteServer("gpu", { phase: "connected", generation: 2, since: 1 })]);
  assert.deepEqual(host.get().mountTarget(), { environmentId: "gpu", path: "/fresh/home", displayPath: "/fresh/home" });
  assert.equal(host.requests.at(-1).params.path, "~");
  assert.deepEqual(host.writes, []);
});

test("a picker with zero configured remote servers performs no RPC and cannot supply a mount", async (t) => {
  const host = await mountFolderBrowser(t, api, { servers: [] });
  assert.equal(host.get().state.kind, "no-servers");
  assert.equal(host.get().mountTarget(), null);
  host.get().selectServer("primary");
  host.get().openPath("/local/project");
  assert.deepEqual(host.requests, []);
  assert.deepEqual(host.writes, []);
});
