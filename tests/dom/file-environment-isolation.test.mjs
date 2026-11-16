import assert from "node:assert/strict";
import test, { after } from "node:test";
import { act, dom, loadRenderer, mount, restoreGlobals, waitFor } from "../support/renderer.mjs";
import {
  createFolderBrowserHost,
  deferred,
} from "../../src/renderer/components/remote-folder-picker/folder-browser-test-helpers.mjs";

const api = await loadRenderer(
  "file-environment-isolation",
  'export {subscribeFileWatch} from "./src/renderer/lib/file-watch-subscription.ts"; export {useAtSuggestions} from "./src/renderer/components/chat-input/use-at-suggestions.ts"; export {fileSuggestionCacheKey} from "./src/renderer/lib/file-suggestion-client.ts"; export {loadAttachmentPreview, registerStagedPreviewUrl} from "./src/renderer/lib/attachment-token-previews.ts"; export {readFilePayload, fileToObjectUrl, downloadFileViaRpc} from "./src/renderer/lib/file-blob.ts"; export {getFileApiUrl} from "./src/renderer/components/file-viewer/file-api-url.ts"; export {apiFetch} from "./src/renderer/lib/api-fetch.ts"; export {workspaceStore} from "./src/renderer/lib/workspace-store.ts"; export {environmentRegistry} from "./src/renderer/lib/environment-registry.ts";',
);
after(restoreGlobals);

async function host(t, reply) {
  const boundary = await createFolderBrowserHost(api, { target: dom.window, reply });
  t.after(() => boundary.close());
  api.environmentRegistry.initialize();
  await act(async () => api.workspaceStore.openSpace({ environmentId: "staging", path: "/same" }));
  return boundary;
}

const payload = (content) => ({ content, encoding: "utf8", language: "text", size: content.length });

test("simultaneous previews deduplicate only within one environment and preserve binary bytes and source session", async (t) => {
  const pending = deferred();
  const boundary = await host(t, async (environmentId, _method, params) => {
    await pending.promise;
    assert.equal(params.sourceSessionId, "origin-session");
    return { content: environmentId === "gpu" ? "AP8B" : "AgME", encoding: "base64", mime: "image/png", size: 3 };
  });
  const previews = [
    api.fileToObjectUrl("gpu", "/same/image.png", "origin-session"),
    api.fileToObjectUrl("gpu", "/same/image.png", "origin-session"),
    api.fileToObjectUrl("staging", "/same/image.png", "origin-session"),
  ];
  pending.resolve();
  const results = await Promise.all(previews);
  try {
    assert.equal(boundary.requests.filter((request) => request.method === "files.read").length, 2);
    assert.deepEqual([...new Uint8Array(await (await globalThis.fetch(results[0].url)).arrayBuffer())], [0, 255, 1]);
    assert.deepEqual([...new Uint8Array(await (await globalThis.fetch(results[2].url)).arrayBuffer())], [2, 3, 4]);
    assert.equal(results[0].mime, "image/png");
    assert.notEqual(results[0].url, results[1].url);
  } finally {
    results.forEach((result) => result.revoke());
  }
});

test("a download keeps the captured server and source session while focus changes", async (t) => {
  const saved = [];
  await host(t, (environmentId, method, params) => {
    assert.equal(method, "files.download");
    assert.equal(environmentId, "gpu");
    assert.equal(params.path, "/same/data.bin");
    assert.equal(params.sourceSessionId, "origin-session");
    return { base64: "AP8B", mime: "application/octet-stream" };
  });
  dom.window.piBridge.saveBinaryFile = async (file) => {
    saved.push(file);
    return "/downloads/data.bin";
  };
  dom.window.piBridge.showItemInFolder = async () => {};
  await api.downloadFileViaRpc("gpu", "/same/data.bin", "data.bin", "origin-session");
  assert.deepEqual(saved, [{ base64: "AP8B", defaultPath: "data.bin" }]);
});

test("file URLs and their endpoint retain environment, Windows path and source session", async (t) => {
  const boundary = await host(t, (environmentId, method, params) => ({ environmentId, method, ...params }));
  const url = api.getFileApiUrl("gpu", "C:/same/a b.txt", "read", "origin-session", { environment: "staging" });
  assert.equal(new URL(url, "http://local").searchParams.get("environment"), "gpu");
  const response = await api.apiFetch(url);
  assert.deepEqual(await response.json(), {
    environmentId: "gpu",
    method: "files.read",
    path: "C:/same/a b.txt",
    sourceSessionId: "origin-session",
  });
  assert.equal(boundary.requests.length, 1);
});

test("file watch start and stop retain the captured server across an asynchronous focus switch", async (t) => {
  const pending = deferred();
  const boundary = await host(t, (_id, method) => (method === "files.watchStart" ? pending.promise : { ok: true }));
  const stop = api.subscribeFileWatch({
    environmentId: "gpu",
    path: "/same/path",
    sourceSessionId: "origin-session",
  });
  await waitFor(() => assert.ok(boundary.requests.some((request) => request.method === "files.watchStart")));
  await act(async () => api.workspaceStore.openSpace({ environmentId: "staging", path: "/same" }));
  stop();
  pending.resolve({ ok: true });
  await waitFor(() => assert.ok(boundary.requests.some((request) => request.method === "files.watchStop")));
  assert.ok(boundary.requests.every((request) => request.environmentId === "gpu"));
  assert.equal(
    boundary.requests.find((request) => request.method === "files.watchStart").params.sourceSessionId,
    "origin-session",
  );
});

test("a staged local image never supplies a remote attachment with the same path", async (t) => {
  const boundary = await host(t, () => ({ content: "AP8B", encoding: "base64", mime: "image/png", size: 3 }));
  api.registerStagedPreviewUrl("/same/token.png", "data:image/png;base64,AAAA");
  const src = await api.loadAttachmentPreview("/same/token.png", "origin-session", "gpu");
  assert.notEqual(src, "data:image/png;base64,AAAA");
  assert.deepEqual([...new Uint8Array(await (await globalThis.fetch(src)).arrayBuffer())], [0, 255, 1]);
  assert.equal(boundary.requests[0].environmentId, "gpu");
});

test("file URLs and watches without an environment fail closed instead of inheriting focus", async (t) => {
  const boundary = await host(t);
  const response = await api.apiFetch("/api/files/same/implicit.txt?type=read");
  assert.equal(response.ok, false);
  const errors = [];
  const stop = api.subscribeFileWatch({
    environmentId: undefined,
    path: "/same/implicit.txt",
    onError: (error) => errors.push(error),
  });
  t.after(stop);
  assert.equal(errors.length, 1);
  assert.deepEqual(boundary.requests, []);
});

test("an unavailable attachment can be retried on its original server after recovery", async (t) => {
  let available = false;
  const boundary = await host(t, () => {
    if (!available) throw new Error("Environment is not connected");
    return { content: "AP8B", encoding: "base64", mime: "image/png", size: 3 };
  });
  assert.equal(await api.loadAttachmentPreview("/same/recovery.png", undefined, "gpu"), null);
  available = true;
  const src = await api.loadAttachmentPreview("/same/recovery.png", undefined, "gpu");
  assert.ok(src);
  assert.equal(boundary.requests.length, 2);
  assert.ok(boundary.requests.every((request) => request.environmentId === "gpu"));
});

test("an explicit file read stays on its server when focus points at another server", async (t) => {
  await host(t, (environmentId, _method, params) => payload(`${environmentId}:${params.path}`));
  const result = await api.readFilePayload("gpu", "/same/path");
  assert.equal(result.content, "gpu:/same/path");
});

test("file suggestions for identical paths remain on their owning environment across cache hits", async (t) => {
  const boundary = await host(t, (id, method, params) => {
    assert.equal(method, "files.index");
    assert.equal(params.root, "/same");
    return { files: [`${id}.txt`] };
  });
  const originals = [
    [dom.window, "fetch"],
    [dom.window, "EventSource"],
    [globalThis, "fetch"],
  ].map(([owner, name]) => [owner, name, Object.getOwnPropertyDescriptor(owner, name)]);
  dom.window.fetch = globalThis.fetch;
  api.installApiShims();
  globalThis.fetch = dom.window.fetch;
  t.after(() => {
    for (const [owner, name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(owner, name, descriptor);
      else delete owner[name];
    }
  });
  let result;
  const trigger = { kind: "at", match: { start: 0, query: "", quoted: false } };
  function Probe({ environmentId }) {
    result = api.useAtSuggestions({
      environmentId,
      cwd: "/same",
      atTrigger: trigger,
      editableRef: { current: null },
      onDismiss() {},
    });
    return null;
  }
  const view = await mount(t, Probe, { environmentId: "gpu" });
  await waitFor(() =>
    assert.deepEqual(
      result.atMatches.map((entry) => entry.path),
      ["gpu.txt"],
    ),
  );
  await view.update({ environmentId: "staging" });
  await waitFor(() =>
    assert.deepEqual(
      result.atMatches.map((entry) => entry.path),
      ["staging.txt"],
    ),
  );
  await view.update({ environmentId: "gpu" });
  assert.deepEqual(
    result.atMatches.map((entry) => entry.path),
    ["gpu.txt"],
  );
  assert.deepEqual(
    boundary.requests.map((request) => request.environmentId),
    ["gpu", "staging"],
  );
  assert.notEqual(
    api.fileSuggestionCacheKey("gpu", "/same", "", "linux"),
    api.fileSuggestionCacheKey("staging", "/same", "", "linux"),
  );
});

test("file watch leases renew on a new port and retain their server through events and cleanup", async (t) => {
  const boundary = await host(t, () => ({ ok: true }));
  await act(async () => api.workspaceStore.openSpace({ environmentId: "gpu", path: "/same" }));
  const events = [];
  const opened = [];
  const gaps = [];
  const errors = [];
  const stop = api.subscribeFileWatch({
    environmentId: "gpu",
    path: "/same/watched",
    sourceSessionId: "origin-session",
    onEvent: (event) => events.push(event),
    onOpen: () => opened.push("open"),
    onGap: () => gaps.push("gap"),
    onError: (error) => errors.push(error),
  });
  t.after(stop);
  await waitFor(() => assert.equal(opened.length, 1));
  boundary.emit("gpu", "files.changed", "/other", { path: "/other", event: "change" });
  boundary.emit("staging", "files.changed", "/same/watched", { path: "/same/watched", event: "change" });
  boundary.emit("gpu", "files.changed", "/same/watched", { path: "/same/watched", event: "change", size: 1 });
  assert.deepEqual(
    events.map((event) => event.size),
    [1],
  );
  await boundary.disconnect("gpu");
  assert.ok(errors.some((error) => error.code === "DISCONNECTED"));
  await boundary.reconnect("gpu", 2);
  await waitFor(() => assert.equal(gaps.length, 1));
  assert.equal(opened.length, 2);
  boundary.emit("gpu", "files.changed", "/same/watched", { path: "/same/watched", event: "change", size: 2 });
  assert.deepEqual(
    events.map((event) => event.size),
    [1, 2],
  );
  await act(async () => api.workspaceStore.openSpace({ environmentId: "staging", path: "/same" }));
  stop();
  stop();
  await waitFor(() =>
    assert.equal(boundary.requests.filter((request) => request.method === "files.watchStop").length, 1),
  );
  assert.deepEqual(
    boundary.requests.filter((request) => request.method === "files.watchStart").map((request) => request.params),
    [
      { path: "/same/watched", sourceSessionId: "origin-session" },
      { path: "/same/watched", sourceSessionId: "origin-session" },
    ],
  );
  assert.ok(boundary.requests.every((request) => request.environmentId === "gpu"));
  await boundary.disconnect("gpu");
  await boundary.reconnect("gpu", 3);
  boundary.emit("gpu", "files.changed", "/same/watched", { path: "/same/watched", event: "change", size: 3 });
  assert.deepEqual(
    events.map((event) => event.size),
    [1, 2],
  );
  assert.equal(gaps.length, 1);
});

test("direct file subscriptions reject missing identity without opening a connection", async (t) => {
  const boundary = await host(t);
  const errors = [];
  for (const [environmentId, path] of [
    ["", "/same"],
    ["gpu", ""],
  ]) {
    const stop = api.subscribeFileWatch({ environmentId, path, onError: (error) => errors.push(error) });
    stop();
  }
  assert.equal(errors.length, 2);
  assert.deepEqual(boundary.requests, []);
});

test("closing during watcher startup releases the lease after the host finishes opening it", async (t) => {
  const pending = deferred();
  const started = deferred();
  let stopped = 0;
  let leased = false;
  let opened = false;
  await host(t, async (_id, method) => {
    if (method === "files.watchStart") {
      opened = true;
      await pending.promise;
      leased = true;
      started.resolve();
    }
    if (method === "files.watchStop") {
      leased = false;
      stopped += 1;
    }
    return { ok: true };
  });
  const stop = api.subscribeFileWatch({ environmentId: "gpu", path: "/same/pending" });
  t.after(stop);
  await waitFor(() => assert.equal(opened, true));
  stop();
  await waitFor(() => assert.equal(stopped, 1));
  await act(async () => {
    pending.resolve();
    await started.promise;
  });
  await waitFor(() => assert.equal(leased, false));
});

for (const os of [null, "linux"]) {
  test(`remote suggestions retain case-sensitive paths on a Windows client with platform ${os}`, async (t) => {
    const boundary = await host(t, (_id, method, params) => {
      assert.equal(method, "files.index");
      return {
        matches: [{ path: params.root === "/srv/App" ? "UpperOnly.ts" : "lower-only.ts", isDir: false }],
        truncated: false,
      };
    });
    dom.window.piBridge.platform = "win32";
    if (os)
      await boundary.changeServers(
        api.environmentRegistry
          .getEnvironments()
          .map((view) => (view.id === "gpu" ? { ...view, descriptor: { platform: { os } } } : view)),
      );
    let state;
    const atTrigger = { kind: "at", match: { query: "", start: 0, end: 1 } };
    function Probe({ cwd }) {
      state = api.useAtSuggestions({
        environmentId: "gpu",
        cwd,
        atTrigger,
        editableRef: { current: null },
        onDismiss() {},
      });
      return null;
    }
    const view = await mount(t, Probe, { cwd: "/srv/App" });
    await waitFor(() =>
      assert.deepEqual(
        state.atMatches.map((match) => match.path),
        ["UpperOnly.ts"],
      ),
    );
    await view.update({ cwd: "/srv/app" });
    await waitFor(() =>
      assert.deepEqual(
        state.atMatches.map((match) => match.path),
        ["lower-only.ts"],
      ),
    );
  });
}
