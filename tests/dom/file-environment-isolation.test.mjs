import assert from "node:assert/strict";
import test, { after } from "node:test";
import { act, dom, loadRenderer, restoreGlobals, waitFor } from "../support/renderer.mjs";
import {
  createFolderBrowserHost,
  deferred,
} from "../../src/renderer/components/remote-folder-picker/folder-browser-test-helpers.mjs";

const api = await loadRenderer(
  "file-environment-isolation",
  'export {loadAttachmentPreview, registerStagedPreviewUrl} from "./src/renderer/lib/attachment-token-previews.ts"; export {readFilePayload, fileToObjectUrl, downloadFileViaRpc} from "./src/renderer/lib/file-blob.ts"; export {getFileApiUrl} from "./src/renderer/components/file-viewer/file-api-url.ts"; export {apiFetch, ApiEventSource} from "./src/renderer/lib/api-fetch.ts"; export {workspaceStore} from "./src/renderer/lib/workspace-store.ts"; export {environmentRegistry} from "./src/renderer/lib/environment-registry.ts";',
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

test("file watch start and stop retain the URL server across an asynchronous focus switch", async (t) => {
  const pending = deferred();
  const boundary = await host(t, (_id, method) => (method === "files.watchStart" ? pending.promise : { ok: true }));
  const stream = new api.ApiEventSource("/api/files/same/path?type=watch&environment=gpu&sessionId=origin-session");
  await waitFor(() => assert.ok(boundary.requests.some((request) => request.method === "files.watchStart")));
  await act(async () => api.workspaceStore.openSpace({ environmentId: "staging", path: "/same" }));
  stream.close();
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
  const stream = new api.ApiEventSource("/api/files/same/implicit.txt?type=watch");
  t.after(() => stream.close());
  assert.equal(stream.readyState, api.ApiEventSource.CLOSED);
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
