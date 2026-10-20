import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { downloadRuntimeArtifact } from "./downloader.ts";
import { createElectronRuntimeFetch } from "./electron-runtime-fetch.ts";

class FakeRequest extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.headers = new Map();
    this.followed = 0;
    this.aborted = 0;
    this.ended = 0;
  }

  setHeader(name, value) {
    this.headers.set(name.toLowerCase(), value);
  }

  followRedirect() {
    this.followed += 1;
  }

  abort() {
    this.aborted += 1;
  }

  end() {
    this.ended += 1;
    return this;
  }
}

class FakeIncomingMessage extends EventEmitter {
  constructor(statusCode = 200, rawHeaders = []) {
    super();
    this.statusCode = statusCode;
    this.statusMessage = statusCode === 200 ? "OK" : "Error";
    this.rawHeaders = rawHeaders;
  }
}

function harness() {
  let request;
  const fetchImpl = createElectronRuntimeFetch((options) => {
    request = new FakeRequest(options);
    return request;
  });
  return {
    fetchImpl,
    get request() {
      return request;
    },
  };
}

test("follows only an allowlisted Electron redirect and streams its response", async () => {
  const state = harness();
  const pending = state.fetchImpl("https://github.com/astral-sh/uv/releases/download/0.11.29/uv.tar.gz", {
    headers: { Accept: "application/octet-stream" },
  });
  assert.equal(state.request.options.redirect, "manual");
  assert.equal(state.request.options.bypassCustomProtocolHandlers, true);
  assert.equal(state.request.headers.get("accept"), "application/octet-stream");
  assert.equal(state.request.ended, 1);

  state.request.emit("redirect", 302, "GET", "https://release-assets.githubusercontent.com/fixed/uv.tar.gz", {});
  assert.equal(state.request.followed, 1);

  const incoming = new FakeIncomingMessage(200, ["Content-Length", "8", "Content-Type", "application/octet-stream"]);
  state.request.emit("response", incoming);
  const response = await pending;
  incoming.emit("data", Buffer.from("verified"));
  incoming.emit("end");

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-length"), "8");
  assert.equal(await response.text(), "verified");
});

test("rejects an Electron redirect outside the runtime host allowlist", async () => {
  const state = harness();
  const pending = state.fetchImpl("https://github.com/astral-sh/uv/releases/download/0.11.29/uv.tar.gz");
  state.request.emit("redirect", 302, "GET", "https://evil.invalid/uv.tar.gz", {});
  await assert.rejects(pending, (error) => error.code === "TOOLCHAIN_DOWNLOAD_REJECTED");
  assert.equal(state.request.followed, 0);
  assert.equal(state.request.aborted, 1);
});

test("does not treat close during a followed redirect as a terminal failure", async () => {
  const state = harness();
  const pending = state.fetchImpl("https://github.com/astral-sh/uv/releases/download/0.11.29/uv.tar.gz");
  state.request.emit("redirect", 302, "GET", "https://release-assets.githubusercontent.com/fixed/uv.tar.gz", {});
  state.request.emit("close");

  const incoming = new FakeIncomingMessage(200, ["Content-Length", "2"]);
  state.request.emit("response", incoming);
  const response = await pending;
  incoming.emit("data", Buffer.from("ok"));
  incoming.emit("end");
  assert.equal(await response.text(), "ok");
});

test("enforces the redirect limit before synchronously following", async () => {
  const state = harness();
  const pending = state.fetchImpl("https://github.com/astral-sh/uv/releases/download/0.11.29/uv.tar.gz");
  for (let index = 0; index < 6; index += 1) {
    state.request.emit(
      "redirect",
      302,
      "GET",
      `https://release-assets.githubusercontent.com/fixed/uv-${index}.tar.gz`,
      {},
    );
  }
  await assert.rejects(pending, (error) => error.code === "TOOLCHAIN_DOWNLOAD_REJECTED");
  assert.equal(state.request.followed, 5);
  assert.equal(state.request.aborted, 1);
});

test("aborts an Electron request when the caller cancels", async () => {
  const state = harness();
  const controller = new globalThis.AbortController();
  const pending = state.fetchImpl("https://nodejs.org/dist/v24.18.0/node.tar.gz", {
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(pending, (error) => error.name === "AbortError");
  assert.equal(state.request.aborted, 1);
});

function artifactVariant() {
  const bytes = Buffer.from("expected artifact");
  return {
    platform: "darwin",
    arch: "arm64",
    url: "https://nodejs.org/dist/v24.18.0/node.tar.gz",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    downloadBytes: bytes.length,
    archive: "tar.gz",
    installer: "safe-archive",
  };
}

async function downloadRejection(fetchImpl) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "pi-electron-runtime-fetch-"));
  try {
    await downloadRuntimeArtifact("node-lts", artifactVariant(), path.join(directory, "artifact.partial"), {
      fetchImpl,
    });
    return undefined;
  } catch (error) {
    return error;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function startedElectronDownload() {
  let arrive;
  const requestArrives = new Promise((settle) => {
    arrive = settle;
  });
  const fetchImpl = createElectronRuntimeFetch((options) => {
    const request = new FakeRequest(options);
    arrive(request);
    return request;
  });
  return { requestArrives, rejection: downloadRejection(fetchImpl) };
}

test("an Electron net failure keeps its message and gains the Chromium name as its code", async () => {
  const state = harness();
  const failure = new Error("net::ERR_INTERNET_DISCONNECTED");
  const pending = state.fetchImpl("https://nodejs.org/dist/v24.18.0/node.tar.gz");
  state.request.emit("error", failure);
  await assert.rejects(pending, (error) => {
    assert.equal(error, failure);
    assert.equal(error.message, "net::ERR_INTERNET_DISCONNECTED");
    assert.equal(error.code, "ERR_INTERNET_DISCONNECTED");
    return true;
  });
});

test("an Electron error keeps a code it already has and stays code-less without a Chromium net name", async () => {
  const alreadyCoded = harness();
  const coded = Object.assign(new Error("net::ERR_INTERNET_DISCONNECTED"), { code: "ECONNRESET" });
  const codedPending = alreadyCoded.fetchImpl("https://nodejs.org/dist/v24.18.0/node.tar.gz");
  alreadyCoded.request.emit("error", coded);
  await assert.rejects(codedPending, (error) => error.code === "ECONNRESET");

  const plain = harness();
  const plainFailure = new Error("socket hang up");
  const plainPending = plain.fetchImpl("https://nodejs.org/dist/v24.18.0/node.tar.gz");
  plain.request.emit("error", plainFailure);
  await assert.rejects(plainPending, (error) => error === plainFailure && error.code === undefined);
});

test("a failed Electron connection is reported as an offline download with the Chromium name", async () => {
  const download = startedElectronDownload();
  const request = await download.requestArrives;
  request.emit("error", new Error("net::ERR_INTERNET_DISCONNECTED"));
  const error = await download.rejection;
  assert.equal(error?.code, "TOOLCHAIN_DOWNLOAD_OFFLINE");
  assert.equal(error?.causeCode, "ERR_INTERNET_DISCONNECTED");
});

test("an Electron response body cut by Chromium is reported as an offline download", async () => {
  const download = startedElectronDownload();
  const request = await download.requestArrives;
  const incoming = new FakeIncomingMessage(200);
  request.emit("response", incoming);
  incoming.emit("data", Buffer.from("partial"));
  incoming.emit("error", new Error("net::ERR_CONNECTION_RESET"));
  const error = await download.rejection;
  assert.equal(error?.code, "TOOLCHAIN_DOWNLOAD_OFFLINE");
  assert.equal(error?.causeCode, "ERR_CONNECTION_RESET");
});

test("an Electron certificate failure stays a rejected download", async () => {
  const download = startedElectronDownload();
  const request = await download.requestArrives;
  request.emit("error", new Error("net::ERR_CERT_AUTHORITY_INVALID"));
  const error = await download.rejection;
  assert.equal(error?.code, "TOOLCHAIN_DOWNLOAD_REJECTED");
  assert.equal(error?.causeCode, "ERR_CERT_AUTHORITY_INVALID");
});
