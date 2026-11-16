import assert from "node:assert/strict";
import test, { after } from "node:test";
import { act, dom, loadRenderer, mount, restoreGlobals, text, waitFor } from "../support/renderer.mjs";
import { createFolderBrowserHost } from "../../src/renderer/components/remote-folder-picker/folder-browser-test-helpers.mjs";

const api = await loadRenderer(
  "file-explorer-reconnect",
  'export {useTextFile} from "./src/renderer/components/file-viewer/use-text-file.ts"; export {FileExplorer} from "./src/renderer/components/FileExplorer.tsx"; export {workspaceStore} from "./src/renderer/lib/workspace-store.ts"; export {environmentRegistry} from "./src/renderer/lib/environment-registry.ts";',
);
api.setAppLanguage("en-US");
after(restoreGlobals);

const clean = {
  isGit: true,
  branch: "main",
  clean: true,
  staged: 0,
  modified: 0,
  untracked: 0,
  conflicted: 0,
  entries: [],
};

async function fileHost(t, reply) {
  const host = await createFolderBrowserHost(api, { target: dom.window, reply });
  const originals = [
    [globalThis, "EventSource"],
    [globalThis, "fetch"],
    [dom.window, "EventSource"],
    [dom.window, "fetch"],
  ].map(([owner, name]) => [owner, name, Object.getOwnPropertyDescriptor(owner, name)]);
  dom.window.fetch = globalThis.fetch;
  api.installApiShims();
  globalThis.EventSource = dom.window.EventSource;
  globalThis.fetch = dom.window.fetch;
  t.after(async () => {
    await act(async () => host.close());
    for (const [owner, name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(owner, name, descriptor);
      else delete owner[name];
    }
  });
  api.environmentRegistry.initialize();
  return host;
}

test("the explorer becomes static on disconnect and renews its lease and directory and Git status after reconnect", async (t) => {
  let recovered = false;
  const host = await fileHost(t, (_id, method) => {
    if (method === "files.list") return { entries: [{ name: recovered ? "after.txt" : "before.txt", isDir: false }] };
    if (method === "git.branch") return { isGit: true, branch: "main" };
    if (method === "git.status")
      return recovered
        ? {
            ...clean,
            branch: "recovered",
            clean: false,
            modified: 1,
            entries: [{ path: "after.txt", index: " ", workingTree: "M" }],
          }
        : clean;
    return { ok: true };
  });
  await act(async () => api.workspaceStore.openSpace({ environmentId: "staging", path: "/same" }));
  const view = await mount(t, api.FileExplorer, {
    environmentId: "gpu",
    cwd: "/same",
    personalCwd: null,
    homeDir: "/home/dev",
    activeFilePath: null,
    onOpenFile() {},
  });
  await waitFor(() => assert.ok(text(view.container, "before.txt")));
  await act(async () => host.emit("gpu", "files.changed", "/same", { path: "/same", event: "connected" }));
  assert.ok(text(view.container, "live"));
  await host.disconnect("gpu");
  assert.ok(text(view.container, "static"));
  assert.equal(text(view.container, "Working tree clean"), undefined);
  assert.equal(text(view.container, "Not a Git repository"), undefined);
  recovered = true;
  await host.reconnect("gpu", 2);
  await waitFor(() => assert.ok(text(view.container, "after.txt")));
  assert.ok(text(view.container, "live"));
  assert.ok(text(view.container, "recovered"));
  assert.equal(host.requests.filter((request) => request.method === "files.watchStart").length, 2);
  assert.equal(host.requests.filter((request) => request.method === "git.status").length, 2);
  assert.ok(host.requests.every((request) => request.environmentId === "gpu"));
});

test("a Git RPC failure is unavailable rather than clean or non-Git and recovers on the next connection generation", async (t) => {
  let failed = true;
  const host = await fileHost(t, (_id, method) => {
    if (method === "files.list") return { entries: [] };
    if (method === "git.branch") return { isGit: true, branch: "main" };
    if (method === "git.status") {
      if (failed) throw Object.assign(new Error("Git status disconnected"), { code: "DISCONNECTED" });
      return clean;
    }
    return { ok: true };
  });
  const view = await mount(t, api.FileExplorer, {
    environmentId: "gpu",
    cwd: "/same",
    homeDir: "/home/dev",
    personalCwd: null,
    activeFilePath: null,
    onOpenFile() {},
  });
  await waitFor(() => assert.match(view.container.textContent, /Git status disconnected/));
  assert.equal(text(view.container, "Working tree clean"), undefined);
  assert.equal(text(view.container, "Not a Git repository"), undefined);
  await host.disconnect("gpu");
  failed = false;
  await host.reconnect("gpu", 2);
  await waitFor(() => assert.ok(text(view.container, "Working tree clean")));
  assert.doesNotMatch(view.container.textContent, /disconnected/);
  assert.ok(host.requests.every((request) => request.environmentId === "gpu"));
});

test("a file deleted offline becomes unavailable even when its watcher cannot restart", async (t) => {
  let deleted = false;
  const host = await fileHost(t, (_id, method) => {
    if (method === "files.read") {
      if (deleted) throw Object.assign(new Error("File no longer exists"), { code: "NOT_FOUND" });
      return { content: "before disconnect", encoding: "utf8", language: "text", size: 17 };
    }
    if (method === "git.headContent") return { comparable: false };
    if (method === "files.watchStart" && deleted)
      throw Object.assign(new Error("Path not found"), { code: "NOT_FOUND" });
    return { ok: true };
  });
  let state;
  function Probe() {
    state = api.useTextFile("gpu", "/same/deleted.txt");
    return null;
  }
  await mount(t, Probe);
  await waitFor(() => assert.equal(state.watching, true));
  assert.equal(state.loadState.data.content, "before disconnect");
  await host.disconnect("gpu");
  deleted = true;
  await host.reconnect("gpu", 2);
  await waitFor(() => assert.equal(state.loadState.status, "error"));
  assert.equal(state.watching, false);
});
