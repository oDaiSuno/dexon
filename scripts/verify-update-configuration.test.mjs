import assert from "node:assert/strict";
import test from "node:test";
import { verifyUpdateConfiguration } from "./verify-update-configuration.mjs";

const configuration = "provider: github\nowner: oDaiSuno\nrepo: dexon\nupdaterCacheDirName: dexon-updater\n";

test("packaged update settings cannot replace the official source or carry credentials and publisher claims", () => {
  for (const entry of [
    "url: https://example.com",
    "token: secret",
    "publisherName: Trusted Publisher",
    "channel: beta",
    "headers: {}",
  ])
    assert.throws(
      () => verifyUpdateConfiguration(`${configuration}${entry}\n`, "oDaiSuno/dexon"),
      /forbidden|unexpected/i,
    );
});

test("the official update repository is mandatory and values cannot hide a token or authenticated URL", () => {
  for (const document of [
    "",
    configuration.replace("github", "generic"),
    configuration.replace("oDaiSuno", "elsewhere"),
    configuration.replace("repo: dexon", "repo: unrelated"),
    `${configuration}releaseType: https://user:password@example.com\n`,
    `${configuration}releaseType: ghp_1234567890123456789012345\n`,
    `${configuration}releaseType: Bearer abcdefgh123456\n`,
  ]) {
    assert.throws(() => verifyUpdateConfiguration(document, "oDaiSuno/dexon"), /repository|credential|configuration/);
  }
});

test("the official credential-free updater configuration remains valid", () => {
  verifyUpdateConfiguration(`${configuration}releaseType: draft\n`, "oDaiSuno/dexon");
});
