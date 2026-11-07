import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { act, dom, loadRenderer, mount, restoreGlobals, waitFor } from "../support/renderer.mjs";
import {
  createFolderBrowserHost,
  deferred,
} from "../../src/renderer/components/remote-folder-picker/folder-browser-test-helpers.mjs";

const api = await loadRenderer(
  "file-viewer-environments",
  'export {UserMessageBubble} from "./src/renderer/components/messages/user-message-bubble.tsx"; export {FileExplorer} from "./src/renderer/components/FileExplorer.tsx"; export {HtmlPreview} from "./src/renderer/components/file-viewer/html-preview.tsx"; export {FileViewer} from "./src/renderer/components/FileViewer.tsx"; export {MarkdownBody} from "./src/renderer/components/MarkdownBody.tsx"; export {workspaceStore} from "./src/renderer/lib/workspace-store.ts"; export {environmentRegistry} from "./src/renderer/lib/environment-registry.ts";',
  { alias: { mammoth: fileURLToPath(new URL("../../node_modules/mammoth/mammoth.browser.js", import.meta.url)) } },
);
after(restoreGlobals);

async function setup(t, reply) {
  const host = await createFolderBrowserHost(api, { target: dom.window, reply });
  const originals = [
    [globalThis, "EventSource"],
    [globalThis, "fetch"],
    [dom.window, "fetch"],
    [dom.window, "EventSource"],
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
  await act(async () => api.workspaceStore.openSpace({ environmentId: "staging", path: "/same" }));
  return host;
}

const text = (content) => ({ content, encoding: "utf8", language: "text", size: content.length });

test("remote HTML previews never ask the local native preview service to resolve remote assets", async (t) => {
  await setup(t, () => ({ ok: true }));
  let nativePreviews = 0;
  dom.window.piBridge.createHtmlPreview = async () => {
    nativePreviews += 1;
    return "app://preview/local";
  };
  dom.window.piBridge.releaseHtmlPreview = async () => {};
  const view = await mount(t, api.HtmlPreview, {
    environmentId: "gpu",
    filePath: "/same/index.html",
    content: '<h1>Remote content</h1><img src="file:///same/secret.png">',
  });
  assert.equal(nativePreviews, 0);
  const frame = view.container.querySelector("iframe");
  assert.match(frame.srcdoc, /Content-Security-Policy/);
  assert.match(frame.srcdoc, /default-src 'none'/);
  assert.match(frame.srcdoc, /Remote content/);
  assert.equal(frame.getAttribute("sandbox"), "");
});

test("a Markdown file image retains the file's explicit environment while focus belongs elsewhere", async (t) => {
  const host = await setup(t, (id, method, params) => {
    assert.equal(method, "files.read");
    assert.equal(params.path, "/same/image.png");
    return { content: id === "gpu" ? "AP8B" : "AgME", encoding: "base64", mime: "image/png", size: 3 };
  });
  const view = await mount(t, api.MarkdownBody, {
    environmentId: "gpu",
    cwd: "/same",
    children: "![example](image.png)",
  });
  await waitFor(() => assert.ok(view.container.querySelector("img")));
  assert.equal(host.requests[0].environmentId, "gpu");
  assert.deepEqual(
    [...new Uint8Array(await (await globalThis.fetch(view.container.querySelector("img").src)).arrayBuffer())],
    [0, 255, 1],
  );
});

test("directory listings and Git status stay on the explorer's server, not the focused server", async (t) => {
  const host = await setup(t, (id, method) => {
    if (method === "files.list") return { entries: [{ name: `${id}.txt`, isDir: false, size: 1 }] };
    if (method === "git.branch" || method === "git.status") return { isGit: false };
    return { ok: true };
  });
  const view = await mount(t, api.FileExplorer, {
    environmentId: "gpu",
    cwd: "/same",
    personalCwd: null,
    homeDir: "/home/dev",
    activeFilePath: null,
    onOpenFile() {},
  });
  await waitFor(() => assert.match(view.container.textContent, /gpu.txt/));
  assert.doesNotMatch(view.container.textContent, /staging.txt/);
  assert.match(view.container.textContent, /Remote project files/);
  assert.match(view.container.textContent, /same \(gpu\)/);
  assert.ok(host.requests.every((request) => request.environmentId === "gpu"));
});

test("attachment tokens in a message use its explicit server and replace previews on environment switches", async (t) => {
  const host = await setup(t, (id) => ({
    content: id === "gpu" ? "AP8B" : "AgME",
    encoding: "base64",
    mime: "image/png",
    size: 3,
  }));
  const props = {
    environmentId: "gpu",
    message: { role: "user", content: "@/same/message.png", timestamp: 1 },
    prose: "@/same/message.png",
    leadingSkillName: null,
    imageBlocks: [],
    bubbleStyle: { background: "var(--fx-surface-main)", foreground: "var(--fx-text-primary)" },
  };
  const view = await mount(t, api.UserMessageBubble, props);
  await waitFor(() => assert.ok(view.container.querySelector("img")));
  assert.equal(host.requests[0].environmentId, "gpu");
  const bytes = async () => [
    ...new Uint8Array(await (await globalThis.fetch(view.container.querySelector("img").src)).arrayBuffer()),
  ];
  assert.deepEqual(await bytes(), [0, 255, 1]);
  await view.update({ ...props, environmentId: "staging" });
  await waitFor(() => assert.ok(host.requests.some((request) => request.environmentId === "staging")));
  await waitFor(() => assert.ok(view.container.querySelector("img")));
  assert.deepEqual(await bytes(), [2, 3, 4]);
});

test("a late text response from server A cannot replace server B's identical-path viewer", async (t) => {
  const pending = deferred();
  const host = await setup(t, (id, method) => {
    if (method === "files.read") return id === "gpu" ? pending.promise : text("B content");
    if (method === "git.headContent") return { comparable: false, content: "" };
    return { ok: true };
  });
  const view = await mount(t, api.FileViewer, { environmentId: "gpu", filePath: "/same/file.txt" });
  await waitFor(() =>
    assert.ok(host.requests.some((request) => request.method === "files.read" && request.environmentId === "gpu")),
  );
  await view.update({ environmentId: "staging", filePath: "/same/file.txt" });
  await waitFor(() => assert.match(view.container.textContent, /B content/));
  await act(async () => pending.resolve(text("A content")));
  assert.doesNotMatch(view.container.textContent, /A content/);
  assert.ok(
    host.requests
      .filter((request) => request.method === "files.read")
      .every((request) => request.params.path === "/same/file.txt"),
  );
});

for (const [extension, selector, mime] of [
  ["png", "img", "image/png"],
  ["mp3", "audio", "audio/mpeg"],
  ["pdf", "iframe", "application/pdf"],
]) {
  test(`${extension} preview bytes come from the explicit server even when another server has the same path`, async (t) => {
    const host = await setup(t, (id, method, params) => {
      if (method === "files.read") {
        assert.equal(params.sourceSessionId, "origin-session");
        return { content: id === "gpu" ? "AP8B" : "AgME", encoding: "base64", mime, size: 3 };
      }
      return { ok: true };
    });
    const view = await mount(t, api.FileViewer, {
      environmentId: "gpu",
      filePath: `/same/file.${extension}`,
      sourceSessionId: "origin-session",
    });
    await waitFor(() => assert.ok(view.container.querySelector(selector)));
    const src = view.container.querySelector(selector).src;
    assert.deepEqual([...new Uint8Array(await (await globalThis.fetch(src)).arrayBuffer())], [0, 255, 1]);
    assert.ok(host.requests.every((request) => request.environmentId === "gpu"));
  });
}

const DOCX =
  "UEsDBBQAAAAIAMq5Zl1Rl+gEsQAAABQBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH2QvQ7CMAyEX6XKilpXDAyo7QKswMALWInbRjQ/StxS3p4UUAcGRvu7O59c3Z6eYjabwcZa9Mx+DxBlTwZj4TzZRFoXDHIaQwce5R07gm1Z7kA6y2Q55yVDNNWRWhwHzk5zWkftbC2SXWSHj245VQv0ftASOWFYKDTVZaIQtKLsioHPaJIKHi4oUE6OJjmL/zGTVT9dc9e2WtLqX9J8cJJi1LYzQ7ESg9puvj3g/YzmBVBLAwQUAAAACADKuWZdYXsvQ4kAAADyAAAACwAAAF9yZWxzLy5yZWxzjc87DgIhEAbgqxAOsLNaWBigstnWeAECwyMujwwY9fZSWKzGwnLmn3x/Rpxx1T2W3EKsjT3Smpvkofd6BGgmYNJtKhXzSFyhpPsYyUPV5qo9wn6eD0BbgyuxNdliJafF7ji7PCv+YxfnosFTMbeEuf+o+LoYsiaPXfJ7IQv2vZ4Gy0EJ+HhRvQBQSwMEFAAAAAgAyrlmXRmC9Et/AAAApAAAABEAAAB3b3JkL2RvY3VtZW50LnhtbEXOMQ7CMAwF0KtEPQCuGBiikAV2JCbWkJi0Uh1bSarA7WnKwPK+bOtLNk0H9ithqupNSyq6nYepVtEAxU9IrhxYMG23F2dydRtzhMY5SGaPpcwp0gLHcTwBuTkN1jT95PDpKZ3cqfaOxBXV9XZ5KE4qymqg77t5V3Z/Xfj/Zb9QSwECFAMUAAAACADKuWZdUZfoBLEAAAAUAQAAEwAAAAAAAAAAAAAAgAEAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUAxQAAAAIAMq5Zl1hey9DiQAAAPIAAAALAAAAAAAAAAAAAACAAeIAAABfcmVscy8ucmVsc1BLAQIUAxQAAAAIAMq5Zl0ZgvRLfwAAAKQAAAARAAAAAAAAAAAAAACAAZQBAAB3b3JkL2RvY3VtZW50LnhtbFBLBQYAAAAAAwADALkAAABCAgAAAAA=";

test("DOCX conversion requests the explicit server and displays only its returned document", async (t) => {
  const host = await setup(t, (_id, method, params) => {
    if (method === "files.preview") {
      assert.equal(params.path, "/same/document.docx");
      assert.equal(params.sourceSessionId, "origin-session");
      return { kind: "docx", base64: DOCX };
    }
    return { ok: true };
  });
  const view = await mount(t, api.FileViewer, {
    environmentId: "gpu",
    filePath: "/same/document.docx",
    sourceSessionId: "origin-session",
  });
  await waitFor(() => assert.ok(view.container.querySelector("iframe"), view.container.textContent));
  const html = await (await globalThis.fetch(view.container.querySelector("iframe").src)).text();
  assert.match(html, /Remote DOCX on gpu/);
  assert.ok(host.requests.every((request) => request.environmentId === "gpu"));
});
