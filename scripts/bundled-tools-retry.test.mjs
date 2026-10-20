import assert from "node:assert/strict";
import test from "node:test";
import { httpDownloadFailure, isRetryableDownloadFailure } from "./bundled-tools-retry.mjs";

function codedError(message, code) {
  return Object.assign(new Error(message), { code });
}

test("when the network drops the connection, the bundled-tool build tries the download again", () => {
  const failure = new TypeError("fetch failed", {
    cause: codedError("connect ECONNREFUSED 127.0.0.1:443", "ECONNREFUSED"),
  });
  assert.equal(isRetryableDownloadFailure(failure), true);
});

test("when the downloader reports the source as offline, the bundled-tool build tries again", () => {
  assert.equal(isRetryableDownloadFailure(codedError("could not download", "TOOLCHAIN_DOWNLOAD_OFFLINE")), true);
});

test("when the license host answers with a server error, the bundled-tool build tries again", () => {
  const failure = httpDownloadFailure("https://raw.githubusercontent.com/BurntSushi/ripgrep/15.2.0/UNLICENSE", 503);
  assert.match(failure.message, /returned HTTP 503/);
  assert.equal(isRetryableDownloadFailure(failure), true);
});

test("when a downloaded file does not match its recorded fingerprint, the build stops immediately", () => {
  assert.equal(isRetryableDownloadFailure(codedError("checksum mismatch", "TOOLCHAIN_INTEGRITY_FAILED")), false);
  assert.equal(isRetryableDownloadFailure(new Error("ripgrep-LICENSE-MIT failed fixed license verification")), false);
});

test("when the license host answers with a client error, the build stops immediately", () => {
  const failure = httpDownloadFailure("https://raw.githubusercontent.com/sharkdp/fd/v10.3.0/LICENSE-MIT", 404);
  assert.equal(isRetryableDownloadFailure(failure), false);
});

test("an unrelated failure is not treated as a transient network problem", () => {
  for (const value of [new Error("disk is full"), undefined, null, "ECONNRESET", { code: 7 }]) {
    assert.equal(isRetryableDownloadFailure(value), false);
  }
});
