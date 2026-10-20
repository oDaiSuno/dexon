import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { downloadRuntimeArtifact } from "./downloader.ts";

function variant(bytes, overrides = {}) {
  return {
    platform: "darwin",
    arch: "arm64",
    url: "https://nodejs.org/dist/v24.18.0/node.tar.gz",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    downloadBytes: bytes.length,
    archive: "tar.gz",
    installer: "safe-archive",
    ...overrides,
  };
}

test("streams an exact allowlisted artifact and reports bounded progress", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "pi-toolchain-download-"));
  try {
    const bytes = Buffer.from("verified artifact");
    const progress = [];
    const destination = path.join(directory, "artifact.partial");
    await downloadRuntimeArtifact("node-lts", variant(bytes), destination, {
      fetchImpl: async () =>
        new globalThis.Response(bytes, { status: 200, headers: { "content-length": String(bytes.length) } }),
      onProgress: (value) => progress.push(value),
    });
    assert.deepEqual(readFileSync(destination), bytes);
    assert.deepEqual(progress.at(-1), { downloadedBytes: bytes.length, totalBytes: bytes.length });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects size and checksum mismatches and removes the partial artifact", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "pi-toolchain-download-bad-"));
  try {
    const destination = path.join(directory, "artifact.partial");
    const expected = Buffer.from("expected");
    const actual = Buffer.from("tampered");
    await assert.rejects(
      downloadRuntimeArtifact("node-lts", variant(expected), destination, {
        fetchImpl: async () => new globalThis.Response(actual, { status: 200 }),
      }),
      (error) => error.code === "TOOLCHAIN_INTEGRITY_FAILED",
    );
    assert.equal(existsSync(destination), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects a redirect outside the fixed download host set", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "pi-toolchain-download-redirect-"));
  try {
    await assert.rejects(
      downloadRuntimeArtifact("node-lts", variant(Buffer.from("x")), path.join(directory, "artifact"), {
        fetchImpl: async () =>
          new globalThis.Response(null, { status: 302, headers: { location: "https://evil.invalid/a" } }),
      }),
      (error) => error.code === "TOOLCHAIN_DOWNLOAD_REJECTED",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function codedError(message, code) {
  return Object.assign(new Error(message), { code });
}

async function waitForFile(filePath) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (existsSync(filePath)) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`the artifact ${filePath} was never created`);
}

test("a fetch failure caused by a refused connection reports the download source as offline", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "pi-toolchain-download-refused-"));
  try {
    const destination = path.join(directory, "artifact.partial");
    await assert.rejects(
      downloadRuntimeArtifact("node-lts", variant(Buffer.from("x")), destination, {
        fetchImpl: async () => {
          throw new TypeError("fetch failed", {
            cause: codedError("connect ECONNREFUSED 127.0.0.1:443", "ECONNREFUSED"),
          });
        },
      }),
      (error) => error.code === "TOOLCHAIN_DOWNLOAD_OFFLINE" && error.causeCode === "ECONNREFUSED",
    );
    assert.equal(existsSync(destination), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a connect timeout reported only inside the fetch failure cause still reports the source as offline", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "pi-toolchain-download-timeout-"));
  try {
    await assert.rejects(
      downloadRuntimeArtifact("node-lts", variant(Buffer.from("x")), path.join(directory, "artifact.partial"), {
        fetchImpl: async () => {
          throw new TypeError("fetch failed", {
            cause: codedError("Connect Timeout Error", "UND_ERR_CONNECT_TIMEOUT"),
          });
        },
      }),
      (error) => error.code === "TOOLCHAIN_DOWNLOAD_OFFLINE" && error.causeCode === "UND_ERR_CONNECT_TIMEOUT",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a fetch failure without any network code stays a rejected download", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "pi-toolchain-download-rejected-"));
  try {
    await assert.rejects(
      downloadRuntimeArtifact("node-lts", variant(Buffer.from("x")), path.join(directory, "artifact.partial"), {
        fetchImpl: async () => {
          throw new TypeError("fetch failed", { cause: new Error("unsupported scheme") });
        },
      }),
      (error) => error.code === "TOOLCHAIN_DOWNLOAD_REJECTED" && error.causeCode === undefined,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a body stream cut by a connection reset reports the source as offline and drops the partial file", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "pi-toolchain-download-reset-"));
  try {
    const destination = path.join(directory, "artifact.partial");
    const body = new globalThis.ReadableStream({
      start(stream) {
        stream.enqueue(Buffer.from("partial"));
      },
      async pull(stream) {
        await waitForFile(destination);
        stream.error(new TypeError("terminated", { cause: codedError("read ECONNRESET", "ECONNRESET") }));
      },
    });
    await assert.rejects(
      downloadRuntimeArtifact("node-lts", variant(Buffer.from("expected artifact")), destination, {
        fetchImpl: async () => new globalThis.Response(body, { status: 200 }),
      }),
      (error) => error.code === "TOOLCHAIN_DOWNLOAD_OFFLINE" && error.causeCode === "ECONNRESET",
    );
    assert.equal(existsSync(destination), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a body stream that dies before the first byte reports the source as offline", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "pi-toolchain-download-empty-reset-"));
  try {
    const destination = path.join(directory, "artifact.partial");
    const body = new globalThis.ReadableStream({
      start(stream) {
        stream.error(new TypeError("terminated", { cause: codedError("other side closed", "UND_ERR_SOCKET") }));
      },
    });
    await assert.rejects(
      downloadRuntimeArtifact("node-lts", variant(Buffer.from("expected artifact")), destination, {
        fetchImpl: async () => new globalThis.Response(body, { status: 200 }),
      }),
      (error) => error.code === "TOOLCHAIN_DOWNLOAD_OFFLINE" && error.causeCode === "UND_ERR_SOCKET",
    );
    assert.equal(existsSync(destination), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a caller cancellation during the body stream stays a cancellation even when the stream dies with a reset", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "pi-toolchain-download-cancel-stream-"));
  try {
    const destination = path.join(directory, "artifact.partial");
    const controller = new globalThis.AbortController();
    const body = new globalThis.ReadableStream({
      start(stream) {
        controller.signal.addEventListener(
          "abort",
          () => stream.error(new TypeError("terminated", { cause: codedError("read ECONNRESET", "ECONNRESET") })),
          { once: true },
        );
      },
    });
    const pending = downloadRuntimeArtifact("node-lts", variant(Buffer.from("expected artifact")), destination, {
      signal: controller.signal,
      fetchImpl: async () => new globalThis.Response(body, { status: 200 }),
    });
    controller.abort();
    await assert.rejects(pending, (error) => error.code === "TOOLCHAIN_CANCELLED");
    assert.equal(existsSync(destination), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("aborts an in-flight download and removes its partial artifact", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "pi-toolchain-download-cancel-"));
  try {
    const destination = path.join(directory, "artifact.partial");
    const controller = new globalThis.AbortController();
    const pending = downloadRuntimeArtifact("node-lts", variant(Buffer.from("x")), destination, {
      signal: controller.signal,
      fetchImpl: async (_input, init) =>
        new Promise((_resolve, reject) => {
          if (init.signal.aborted) reject(new Error("aborted"));
          else init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
    });
    controller.abort();
    await assert.rejects(pending, (error) => error.code === "TOOLCHAIN_CANCELLED");
    assert.equal(existsSync(destination), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
