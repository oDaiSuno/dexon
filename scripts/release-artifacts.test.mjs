import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createArtifactManifest, verifyArtifactManifest, stageArtifacts } from "./release-artifacts.mjs";

const identity = {
  commit: "1234567890abcdef1234567890abcdef12345678",
  runId: "123",
  runAttempt: "1",
  version: "0.1.1",
  target: "linux-x64",
  signing: "unsigned",
};
const digest = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dexon-release-manifest-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const name of ["Dexon-0.1.1-x86_64.AppImage", "latest-linux.yml"]) {
    fs.writeFileSync(path.join(directory, name), "abc");
  }
  return directory;
}

test("the candidate records the exact final filenames, bytes and SHA-256 with its build identity", async (t) => {
  const manifest = await createArtifactManifest(fixture(t), identity);
  assert.deepEqual(manifest, {
    schemaVersion: 1,
    ...identity,
    files: [
      { name: "Dexon-0.1.1-x86_64.AppImage", bytes: 3, sha256: digest },
      { name: "latest-linux.yml", bytes: 3, sha256: digest },
    ],
  });
});

test("every desktop target records its complete downloads, update metadata and required notices", async (t) => {
  const targets = {
    "darwin-arm64": [
      "Dexon-0.1.1-arm64.dmg",
      "Dexon-0.1.1-arm64.dmg.blockmap",
      "Dexon-0.1.1-arm64.zip",
      "Dexon-0.1.1-arm64.zip.blockmap",
      "latest-mac.yml",
    ],
    "darwin-x64": [
      "Dexon-0.1.1-x64.dmg",
      "Dexon-0.1.1-x64.dmg.blockmap",
      "Dexon-0.1.1-x64.zip",
      "Dexon-0.1.1-x64.zip.blockmap",
      "latest-mac.yml",
    ],
    darwin: [
      "Dexon-0.1.1-arm64.dmg",
      "Dexon-0.1.1-arm64.dmg.blockmap",
      "Dexon-0.1.1-arm64.zip",
      "Dexon-0.1.1-arm64.zip.blockmap",
      "Dexon-0.1.1-x64.dmg",
      "Dexon-0.1.1-x64.dmg.blockmap",
      "Dexon-0.1.1-x64.zip",
      "Dexon-0.1.1-x64.zip.blockmap",
      "latest-mac.yml",
    ],
    "win32-x64": [
      "Dexon-Unsigned-Beta-Setup-0.1.1.exe",
      "Dexon-Unsigned-Beta-Setup-0.1.1.exe.blockmap",
      "Dexon-Windows-x64-0.1.1.cdx.json",
      "THIRD_PARTY_NOTICES.md",
      "latest.yml",
    ],
  };
  for (const [target, names] of Object.entries(targets)) {
    const directory = fixture(t);
    for (const name of names) fs.writeFileSync(path.join(directory, name), "abc");
    const manifest = await createArtifactManifest(directory, { ...identity, target });
    assert.deepEqual(
      manifest.files.map(({ name }) => name),
      names,
      target,
    );
  }
});

test("changing a byte after acceptance blocks publication even when the filename and size are unchanged", async (t) => {
  const directory = fixture(t);
  const manifest = await createArtifactManifest(directory, identity);
  fs.writeFileSync(path.join(directory, "Dexon-0.1.1-x86_64.AppImage"), "abd");
  await assert.rejects(verifyArtifactManifest(directory, manifest, identity), /manifest|digest|SHA/i);
});

test("an unchanged candidate can be verified again during a later attempt of the same run", async (t) => {
  const directory = fixture(t);
  const manifest = await createArtifactManifest(directory, identity);
  await verifyArtifactManifest(directory, manifest, { ...identity, runAttempt: "2" });
});

test("candidate creation rejects unsupported identities, empty files and filesystem links", async (t) => {
  for (const change of [
    { target: "other" },
    { version: "../../escape" },
    { commit: "main" },
    { runId: "" },
    { runAttempt: "" },
    { signing: "maybe" },
  ]) {
    await assert.rejects(
      createArtifactManifest(fixture(t), { ...identity, ...change }),
      /identity|target|version|commit|run|signing/i,
    );
  }
  const directory = fixture(t);
  const installer = path.join(directory, "Dexon-0.1.1-x86_64.AppImage");
  fs.writeFileSync(installer, "");
  await assert.rejects(createArtifactManifest(directory, identity), /empty|regular/);
  fs.rmSync(installer);
  const elsewhere = fixture(t);
  fs.symlinkSync(elsewhere, installer, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(createArtifactManifest(directory, identity), /regular|link/);
});

test("missing, renamed or extra manifest entries and a mismatched candidate identity block publication", async (t) => {
  const directory = fixture(t);
  const manifest = await createArtifactManifest(directory, identity);
  for (const change of [
    { commit: "a".repeat(40) },
    { runId: "456" },
    { version: "0.1.2" },
    { target: "darwin-arm64" },
    { signing: "signed-notarized" },
    { schemaVersion: 2 },
  ]) {
    await assert.rejects(verifyArtifactManifest(directory, { ...manifest, ...change }, identity));
  }
  await assert.rejects(verifyArtifactManifest(directory, { ...manifest, files: manifest.files.slice(1) }, identity));
  await assert.rejects(
    verifyArtifactManifest(
      directory,
      { ...manifest, files: [...manifest.files, { name: "../outside", bytes: 3, sha256: digest }] },
      identity,
    ),
  );
  fs.renameSync(path.join(directory, "Dexon-0.1.1-x86_64.AppImage"), path.join(directory, "renamed.AppImage"));
  await assert.rejects(verifyArtifactManifest(directory, manifest, identity));
});

test("staging refuses changed inputs and uploads only the verified files with their manifest", async (t) => {
  const directory = fixture(t);
  const manifest = await createArtifactManifest(directory, identity);
  fs.writeFileSync(path.join(directory, "unexpected.txt"), "not a release asset");
  const destination = path.join(directory, "upload");
  await stageArtifacts(directory, destination, manifest);
  assert.equal(fs.existsSync(destination), true, "staging must produce the upload directory");
  assert.deepEqual(fs.readdirSync(destination).sort(), [
    "Dexon-0.1.1-x86_64.AppImage",
    "latest-linux.yml",
    "linux-x64.manifest.json",
  ]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(destination, "linux-x64.manifest.json"), "utf8")), manifest);
  fs.writeFileSync(path.join(directory, "latest-linux.yml"), "tampered");
  await assert.rejects(stageArtifacts(directory, path.join(directory, "changed"), manifest));
  assert.equal(fs.existsSync(path.join(directory, "changed")), false);
});
