import assert from "node:assert/strict";
import test, { after } from "node:test";
import { Blob, File } from "node:buffer";
import { createRef } from "react";
import { attributionFixture, remoteView, rootEl, restoreGlobals, harness, act } from "./remote-attribution.harness.mjs";

after(restoreGlobals);

const textbox = () => rootEl.querySelector('[role="textbox"]');

function replaceValue(t, target, name, value) {
  const previous = Object.getOwnPropertyDescriptor(target, name);
  Object.defineProperty(target, name, { configurable: true, writable: true, value });
  t.after(() => {
    if (previous) Object.defineProperty(target, name, previous);
    else delete target[name];
  });
}
const globalValue = (t, name, value) => replaceValue(t, globalThis, name, value);
const bridgeMethod = (t, name, value) => replaceValue(t, harness.dom.window.piBridge, name, value);
const props = (environmentId, draftKey, ref) => ({
  environmentId,
  draftKey,
  ref,
  cwd: "/srv/shared",
  isStreaming: false,
  onSend() {},
  onAbort() {},
});
const uploadView = (id = "remote-a", enabled = true) => ({
  ...remoteView(id),
  descriptor: {
    platform: { os: "linux", pathStyle: "posix" },
    capabilities: { remoteAttachmentUpload: enabled },
  },
});
const staged = (name = "report.txt", mime = "text/plain") => ({
  ok: true,
  staged: { path: `/srv/attachments/${name}`, name, mime, size: 6, deduplicated: false },
});

async function fixture(t) {
  const f = await attributionFixture(t);
  f.api.setAppLanguage("en-US");
  await f.push({ environments: [uploadView(), uploadView("remote-b")] });
  for (const id of ["remote-a", "remote-b"]) {
    f.serve(id, {
      readFile() {
        throw new Error("Staged previews must not read remote files");
      },
    });
  }
  const ref = createRef();
  await f.focus("remote-a");
  return { ...f, ref };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function addFiles(f, files) {
  await act(async () => f.ref.current.addFiles(files));
  await f.flush();
}

for (const isStreaming of [false, true]) {
  test(`pending uploads block ${isStreaming ? "queue" : "send"} clicks and Enter without losing edits`, async (t) => {
    const f = await fixture(t);
    const pending = deferred();
    bridgeMethod(t, "stageRemoteAttachment", () => pending.promise);
    const submitted = { onSend: t.mock.fn(), onFollowUp: t.mock.fn() };
    f.api.setDraft("send-gate", { value: "original draft" });
    await f.render(f.api.ChatInput, { ...props("remote-a", "send-gate", f.ref), ...submitted, isStreaming });
    const send = rootEl.querySelector('button[aria-label="Send"]');
    await addFiles(f, [new File(["report"], "report.txt")]);
    await act(async () => send.click());
    await act(async () => {
      textbox().dispatchEvent(new harness.dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    assert.equal(submitted.onSend.mock.callCount() + submitted.onFollowUp.mock.callCount(), 0);
    assert.equal(textbox().textContent, "original draft");
    assert.equal(send.disabled, true);
    assert.equal(send.getAttribute("aria-label"), "Uploading to gpu-a100");
    assert.equal(send.title, "Uploading to gpu-a100");
    assert.equal(textbox().getAttribute("contenteditable"), "true");
    await act(async () => {
      textbox().textContent = "original draft edited during upload";
      textbox().dispatchEvent(new harness.dom.window.InputEvent("input", { bubbles: true }));
    });
    assert.match(rootEl.textContent, /Uploading to gpu-a100/);
    pending.resolve(staged());
    await f.flush();
    assert.ok(textbox().querySelector('[data-path="/srv/attachments/report.txt"]'));
    assert.equal(send.disabled, false);
    await act(async () => send.click());
    const handler = submitted[isStreaming ? "onFollowUp" : "onSend"];
    const message = handler.mock.calls[0].arguments[0];
    assert.match(message, /original draft edited during upload/);
    assert.match(message, /@\/srv\/attachments\/report\.txt/);
    assert.equal(textbox().textContent, "");
  });
}

test("a remote generic file uploads bytes to its environment without inserting the local path", async (t) => {
  const f = await fixture(t);
  const requests = [];
  bridgeMethod(t, "stageRemoteAttachment", async (request) => {
    requests.push(request);
    return staged();
  });
  f.api.setDraft("upload-a", { value: "keep this draft" });
  await f.render(f.api.ChatInput, props("remote-a", "upload-a", f.ref));
  const file = new File(["report"], "report.txt", { type: "text/plain" });
  file.testPath = "/Users/me/private/report.txt";
  await addFiles(f, [file]);
  assert.deepEqual(requests, [
    {
      environmentId: "remote-a",
      name: "report.txt",
      mime: "text/plain",
      base64: "cmVwb3J0",
    },
  ]);
  assert.ok(textbox().querySelector('[data-attachment-token][data-path="/srv/attachments/report.txt"]'));
  assert.ok(textbox().textContent.includes("keep this draft"));
  assert.equal(textbox().textContent.includes("/Users/me/private"), false);
});

test("pasted images upload normalized bytes with a matching extension and display their instant local preview", async (t) => {
  const f = await fixture(t);
  const blobs = new Map();
  t.mock.method(URL, "createObjectURL", (blob) => {
    const url = `blob:normalized-${blobs.size + 1}`;
    blobs.set(url, blob);
    return url;
  });
  globalValue(t, "createImageBitmap", async () => ({ width: 3000, height: 1500, close() {} }));
  t.mock.method(harness.dom.window.HTMLCanvasElement.prototype, "getContext", () => ({
    fillRect() {},
    drawImage() {},
  }));
  t.mock.method(harness.dom.window.HTMLCanvasElement.prototype, "toBlob", function (callback, mime) {
    assert.equal(this.width, 2000);
    assert.equal(this.height, 1000);
    callback(new Blob(["normalized screenshot"], { type: mime }));
  });
  const requests = [];
  bridgeMethod(t, "stageRemoteAttachment", async (request) => {
    requests.push(request);
    return staged("capture.jpg", "image/jpeg");
  });
  let remoteReads = 0;
  f.serve("remote-a", {
    readFile() {
      remoteReads += 1;
      return null;
    },
  });
  await f.render(f.api.ChatInput, props("remote-a", "paste-a", f.ref));
  const file = new File(["original bitmap"], "capture.bmp", { type: "image/bmp" });
  file.testPath = "/Users/me/capture.bmp";
  const paste = new harness.dom.window.Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(paste, "clipboardData", {
    value: {
      items: [{ kind: "file", getAsFile: () => file }],
    },
  });
  await act(async () => textbox().dispatchEvent(paste));
  await f.flush();
  assert.equal(paste.defaultPrevented, true);
  assert.deepEqual(requests, [
    {
      environmentId: "remote-a",
      name: "capture.jpg",
      mime: "image/jpeg",
      base64: "bm9ybWFsaXplZCBzY3JlZW5zaG90",
    },
  ]);
  const image = textbox().querySelector("img");
  assert.ok(image);
  assert.equal(await blobs.get(image.getAttribute("src")).text(), "normalized screenshot");
  assert.equal(blobs.get(image.getAttribute("src")).type, "image/jpeg");
  assert.equal(remoteReads, 0);
});

test("upload progress leaves editing enabled, and retry uploads only failures without clearing the draft", async (t) => {
  const f = await fixture(t);
  const pending = deferred();
  const requests = [];
  bridgeMethod(t, "stageRemoteAttachment", async (request) => {
    requests.push(request);
    if (request.name === "bad.txt" && requests.length === 2) return pending.promise;
    return staged(request.name);
  });
  f.api.setDraft("retry-a", { value: "original draft" });
  await f.render(f.api.ChatInput, props("remote-a", "retry-a", f.ref));
  await addFiles(f, [new File(["ok"], "ok.txt"), new File(["bad"], "bad.txt")]);
  assert.match(rootEl.textContent, /Uploading to gpu-a100/);
  assert.equal(textbox().getAttribute("contenteditable"), "true");
  await act(async () => f.ref.current.insertText(" edited during upload"));
  pending.resolve({ ok: false, code: "upload-failed", message: "Network unavailable" });
  await f.flush();
  assert.match(rootEl.textContent, /Upload to gpu-a100 failed/);
  assert.match(rootEl.textContent, /Network unavailable/);
  assert.match(textbox().textContent, /original draft/);
  assert.match(textbox().textContent, /edited during upload/);
  const retry = [...rootEl.querySelectorAll("button")].find((button) => button.textContent === "Retry");
  assert.ok(retry);
  await act(async () => retry.click());
  await f.flush();
  assert.deepEqual(
    requests.map((request) => request.name),
    ["ok.txt", "bad.txt", "bad.txt"],
  );
  assert.equal(textbox().querySelectorAll('[data-attachment-token][data-path="/srv/attachments/ok.txt"]').length, 1);
  assert.equal(textbox().querySelectorAll('[data-attachment-token][data-path="/srv/attachments/bad.txt"]').length, 1);
  assert.match(textbox().textContent, /original draft/);
  assert.match(textbox().textContent, /edited during upload/);
  assert.doesNotMatch(rootEl.textContent, /Upload to gpu-a100 failed|Uploading to gpu-a100|Network unavailable/);
});

test("generic files above 25 MiB are rejected before reading their bytes and keep the draft", async (t) => {
  const f = await fixture(t);
  let uploads = 0;
  bridgeMethod(t, "stageRemoteAttachment", async () => {
    uploads += 1;
    return staged();
  });
  const file = new File([new Uint8Array(25 * 1024 * 1024 + 1)], "too-large.bin");
  let reads = 0;
  t.mock.method(file, "arrayBuffer", async () => {
    reads += 1;
    return new ArrayBuffer(0);
  });
  f.api.setDraft("large-a", { value: "keep large file draft" });
  await f.render(f.api.ChatInput, props("remote-a", "large-a", f.ref));
  await addFiles(f, [file]);
  assert.equal(reads, 0);
  assert.equal(uploads, 0);
  assert.match(rootEl.textContent, /25 MiB/);
  assert.equal(textbox().textContent, "keep large file draft");
});

test("a remote batch uploads only its first four files and explains how to add the remainder", async (t) => {
  const f = await fixture(t);
  const requests = [];
  bridgeMethod(t, "stageRemoteAttachment", async (request) => {
    requests.push(request);
    return staged(request.name);
  });
  await f.render(f.api.ChatInput, props("remote-a", "batch-a", f.ref));
  await addFiles(
    f,
    Array.from({ length: 6 }, (_, index) => new File([String(index)], `${index}.txt`)),
  );
  assert.deepEqual(
    requests.map((request) => request.name),
    ["0.txt", "1.txt", "2.txt", "3.txt"],
  );
  assert.equal(textbox().querySelectorAll("[data-attachment-token]").length, 4);
  assert.match(rootEl.textContent, /up to 4 files at a time/);
});

test("a capable server with an unavailable upload bridge shows unsupported instead of falling back locally", async (t) => {
  const f = await fixture(t);
  bridgeMethod(t, "stageRemoteAttachment", undefined);
  let localPaths = 0;
  let localImages = 0;
  bridgeMethod(t, "getPathForFile", () => {
    localPaths += 1;
    return "/Users/me/private/report.txt";
  });
  bridgeMethod(t, "stageClipboardImage", async () => {
    localImages += 1;
    return staged();
  });
  f.api.setDraft("unsupported-a", { value: "keep unsupported draft" });
  await f.render(f.api.ChatInput, props("remote-a", "unsupported-a", f.ref));
  await addFiles(f, [new File(["report"], "report.txt"), new File(["gif"], "screen.gif", { type: "image/gif" })]);
  assert.match(rootEl.textContent, /This server does not support attachment uploads/);
  assert.equal(localPaths, 0);
  assert.equal(localImages, 0);
  assert.equal(textbox().textContent, "keep unsupported draft");
  assert.equal(textbox().querySelector("[data-attachment-token]"), null);
});

test("the file picker opens for a capable remote server and uploads selected files", async (t) => {
  const f = await fixture(t);
  const requests = [];
  bridgeMethod(t, "stageRemoteAttachment", async (request) => {
    requests.push(request);
    return staged();
  });
  await f.render(f.api.ChatInput, props("remote-a", "picker-a", f.ref));
  const input = rootEl.querySelector('input[type="file"]');
  let opened = 0;
  t.mock.method(input, "click", () => {
    opened += 1;
  });
  await act(async () => rootEl.querySelector('[aria-label="Add images or local file references"]').click());
  const add = [...rootEl.querySelectorAll('[role="menuitem"]')].find((item) =>
    item.textContent.startsWith("Add files"),
  );
  assert.ok(add);
  await act(async () => add.dispatchEvent(new harness.dom.window.MouseEvent("mousedown", { bubbles: true })));
  assert.equal(opened, 1);
  Object.defineProperty(input, "files", { configurable: true, value: [new File(["report"], "report.txt")] });
  await act(async () => input.dispatchEvent(new harness.dom.window.Event("change", { bubbles: true })));
  await f.flush();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].environmentId, "remote-a");
  assert.ok(textbox().querySelector('[data-path="/srv/attachments/report.txt"]'));
});

test("a remote server without the capability retains the previous local attachment block", async (t) => {
  const f = await fixture(t);
  await f.push({ environments: [uploadView("remote-a", false), uploadView("remote-b")] });
  let uploads = 0;
  let localPaths = 0;
  bridgeMethod(t, "stageRemoteAttachment", async () => {
    uploads += 1;
    return staged();
  });
  bridgeMethod(t, "getPathForFile", () => {
    localPaths += 1;
    return "/Users/me/private/report.txt";
  });
  f.api.setDraft("blocked-a", { value: "blocked remote draft" });
  await f.render(f.api.ChatInput, props("remote-a", "blocked-a", f.ref));
  const input = rootEl.querySelector('input[type="file"]');
  let opened = 0;
  t.mock.method(input, "click", () => {
    opened += 1;
  });
  await act(async () => rootEl.querySelector('[aria-label="Add images or local file references"]').click());
  const add = [...rootEl.querySelectorAll('[role="menuitem"]')].find((item) =>
    item.textContent.startsWith("Add files"),
  );
  await act(async () => add.dispatchEvent(new harness.dom.window.MouseEvent("mousedown", { bubbles: true })));
  await addFiles(f, [new File(["report"], "report.txt")]);
  assert.equal(opened, 0);
  assert.equal(uploads, 0);
  assert.equal(localPaths, 0);
  assert.equal(textbox().textContent, "blocked remote draft");
});

for (const boundary of ["environment", "draft"]) {
  for (const outcome of ["success", "failure", "rejection"]) {
    test(`a late ${outcome} after a ${boundary} switch cannot change the current draft or notices`, async (t) => {
      const f = await fixture(t);
      const pending = deferred();
      const requests = [];
      bridgeMethod(t, "stageRemoteAttachment", async (request) => {
        requests.push(request);
        return request.name === "late.txt" ? pending.promise : staged(request.name);
      });
      f.api.setDraft("scope-a", { value: "server A draft" });
      f.api.setDraft("scope-b", { value: "current draft" });
      await f.render(f.api.ChatInput, props("remote-a", "scope-a", f.ref));
      await addFiles(f, [new File(["late"], "late.txt"), new File(["queued"], "queued.txt")]);
      assert.match(rootEl.textContent, /Uploading to gpu-a100/);
      const nextEnvironment = boundary === "environment" ? "remote-b" : "remote-a";
      await f.focus(nextEnvironment);
      await f.render(f.api.ChatInput, props(nextEnvironment, "scope-b", f.ref));
      await addFiles(
        f,
        Array.from({ length: 5 }, (_, index) => new File(["B"], `current-${index}.txt`)),
      );
      assert.match(rootEl.textContent, /up to 4 files at a time/);
      const currentText = rootEl.textContent;
      if (outcome === "success") pending.resolve(staged("late.txt"));
      else if (outcome === "failure")
        pending.resolve({ ok: false, code: "write-failed", message: "Obsolete A failure" });
      else pending.reject(new Error("Obsolete A rejection"));
      await f.flush();
      assert.equal(rootEl.textContent, currentText);
      assert.deepEqual(
        requests.map((request) => request.name),
        ["late.txt", "current-0.txt", "current-1.txt", "current-2.txt", "current-3.txt"],
      );
      assert.ok(requests.slice(1).every((request) => request.environmentId === nextEnvironment));
      assert.equal(textbox().querySelector('[data-path="/srv/attachments/late.txt"]'), null);
      await f.focus("remote-a");
      await f.render(f.api.ChatInput, props("remote-a", "scope-a", f.ref));
      assert.equal(textbox().textContent, "server A draft");
    });
  }
}

test("a file read completing after a scope switch never starts an obsolete remote upload", async (t) => {
  const f = await fixture(t);
  const pending = deferred();
  const requests = [];
  bridgeMethod(t, "stageRemoteAttachment", async (request) => {
    requests.push(request);
    return staged();
  });
  const file = new File(["late bytes"], "read-late.txt");
  t.mock.method(file, "arrayBuffer", () => pending.promise);
  await f.render(f.api.ChatInput, props("remote-a", "read-a", f.ref));
  await addFiles(f, [file]);
  await f.focus("remote-b");
  f.api.setDraft("read-b", { value: "B remains" });
  await f.render(f.api.ChatInput, props("remote-b", "read-b", f.ref));
  pending.resolve(new Uint8Array([1, 2, 3]).buffer);
  await f.flush();
  assert.deepEqual(requests, []);
  assert.equal(textbox().textContent, "B remains");
  assert.doesNotMatch(rootEl.textContent, /Uploading to|Upload to .* failed/);
});

test("the primary environment continues to attach local paths without remote staging", async (t) => {
  const f = await fixture(t);
  let uploads = 0;
  bridgeMethod(t, "stageRemoteAttachment", async () => {
    uploads += 1;
    return staged();
  });
  await f.focus("primary");
  f.api.setDraft("primary-draft", { value: "local draft" });
  await f.render(f.api.ChatInput, props("primary", "primary-draft", f.ref));
  const file = new File(["report"], "local.txt");
  file.testPath = "/Users/me/local.txt";
  await addFiles(f, [file]);
  assert.equal(uploads, 0);
  assert.ok(textbox().querySelector('[data-path="/Users/me/local.txt"]'));
  assert.match(textbox().textContent, /local draft/);
});

test("a generic file exactly 25 MiB uploads its full bytes", async (t) => {
  const f = await fixture(t);
  const requests = [];
  bridgeMethod(t, "stageRemoteAttachment", async (request) => {
    requests.push(request);
    return staged("limit.bin");
  });
  await f.render(f.api.ChatInput, props("remote-a", "limit-a", f.ref));
  await addFiles(f, [new File([new Uint8Array(26_214_400)], "limit.bin")]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].mime, "application/octet-stream");
  assert.equal(Buffer.from(requests[0].base64, "base64").byteLength, 26_214_400);
  assert.ok(textbox().querySelector('[data-path="/srv/attachments/limit.bin"]'));
});

test("a rejected upload stays retryable without losing the current text", async (t) => {
  const f = await fixture(t);
  let attempts = 0;
  bridgeMethod(t, "stageRemoteAttachment", async () => {
    if (++attempts === 1) throw new Error("Connection interrupted");
    return staged();
  });
  f.api.setDraft("rejected-a", { value: "retry this draft" });
  await f.render(f.api.ChatInput, props("remote-a", "rejected-a", f.ref));
  await addFiles(f, [new File(["report"], "report.txt")]);
  assert.match(rootEl.textContent, /Connection interrupted/);
  assert.equal(textbox().textContent, "retry this draft");
  const retry = [...rootEl.querySelectorAll("button")].find((button) => button.textContent === "Retry");
  await act(async () => {
    retry.click();
    retry.click();
  });
  await f.flush();
  assert.equal(attempts, 2);
  assert.equal(textbox().querySelectorAll("[data-attachment-token]").length, 1);
  assert.match(textbox().textContent, /retry this draft/);
});

test("late image normalization after switching environments cannot upload or replace the current draft", async (t) => {
  const f = await fixture(t);
  const bitmap = deferred();
  globalValue(t, "createImageBitmap", () => bitmap.promise);
  const requests = [];
  bridgeMethod(t, "stageRemoteAttachment", async (request) => {
    requests.push(request);
    return staged("late.png", "image/png");
  });
  await f.render(f.api.ChatInput, props("remote-a", "normalize-a", f.ref));
  await addFiles(f, [new File(["image"], "late.png", { type: "image/png" })]);
  await f.focus("remote-b");
  f.api.setDraft("normalize-b", { value: "B image draft" });
  await f.render(f.api.ChatInput, props("remote-b", "normalize-b", f.ref));
  bitmap.resolve({ width: 1, height: 1, close() {} });
  await f.flush();
  assert.deepEqual(requests, []);
  assert.equal(textbox().textContent, "B image draft");
  assert.equal(textbox().querySelector("img"), null);
});
