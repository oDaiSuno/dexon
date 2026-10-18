import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { artifactIdentity, verifyArtifactManifest } from "./release-artifacts.mjs";
import { assertDraftRelease, getExistingRelease, releaseRequest } from "./github-release.mjs";

const directory = path.resolve(process.argv[2] ?? "release-artifacts");
const repository = process.env.GITHUB_REPOSITORY;
const tag = process.env.GITHUB_REF_NAME;
assert.equal(process.env.GITHUB_REF_TYPE, "tag", "Only a version tag may create a release draft");
assert.ok(process.env.GH_TOKEN, "Publication requires the scoped GitHub token");
const directories = fs
  .readdirSync(directory, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
  .map((entry) => path.join(directory, entry.name));
const files = [];
for (const [target, signing] of [
  ["darwin", "signed-notarized"],
  ["win32-x64", "unsigned-beta"],
  ["linux-x64", "unsigned"],
]) {
  const name = `${target}.manifest.json`;
  const matches = directories.filter((candidate) => fs.existsSync(path.join(candidate, name)));
  assert.equal(matches.length, 1, `Expected one ${target} candidate artifact`);
  const candidate = matches[0];
  const manifestPath = path.join(candidate, name);
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes);
  const identity = artifactIdentity(target, signing);
  assert.equal(tag, `v${identity.version}`, "Release tag must match the verified candidate version");
  await verifyArtifactManifest(candidate, manifest, identity);
  files.push(...manifest.files.map((file) => ({ ...file, path: path.join(candidate, file.name) })), {
    name,
    path: manifestPath,
    bytes: manifestBytes.length,
    sha256: createHash("sha256").update(manifestBytes).digest("hex"),
  });
}
assert.equal(new Set(files.map(({ name }) => name)).size, files.length, "Release asset names must be unique");
await releaseRequest(`/repos/${repository}`);
let release = await getExistingRelease(repository, tag);
if (release) assertDraftRelease(release);
else {
  release = await releaseRequest(`/repos/${repository}/releases`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tag_name: tag,
      name: tag,
      draft: true,
      prerelease: false,
      generate_release_notes: true,
      body: "macOS: Developer ID signed and notarized.\n\nWindows: **Unsigned Beta — Unknown Publisher**. Do not describe this as a certificate-backed trusted Windows build.\n\nFinal installation files were verified without rebuilding or resigning. Candidate manifests record their SHA-256 digests and CI identity. Installer lifecycle coverage is not a test of in-app update discovery or download.\n\nReview the successful workflow and enable immutable releases before publishing this draft.",
    }),
  });
}
assertDraftRelease(release);
const expected = new Map(files.map((file) => [file.name, file]));
for (const asset of release.assets ?? []) {
  const file = expected.get(asset.name);
  assert.ok(
    file,
    `Draft contains an unexpected asset: ${asset.name}; review the draft rather than deleting or overwriting automatically`,
  );
  assert.equal(
    asset.digest,
    `sha256:${file.sha256}`,
    `Existing draft asset differs: ${asset.name}; never overwrite another candidate`,
  );
  assert.equal(asset.size, file.bytes);
}
const existing = new Set((release.assets ?? []).map(({ name }) => name));
for (const file of files) {
  if (existing.has(file.name)) continue;
  assertDraftRelease(await releaseRequest(`/repos/${repository}/releases/${release.id}`));
  const url = new URL(release.upload_url.replace(/\{.*$/, ""));
  url.searchParams.set("name", file.name);
  const uploaded = await releaseRequest(url.href, {
    method: "POST",
    duplex: "half",
    body: fs.createReadStream(file.path),
    headers: { "Content-Type": "application/octet-stream", "Content-Length": String(file.bytes) },
  });
  assert.equal(uploaded.digest, `sha256:${file.sha256}`, `GitHub upload digest mismatch: ${file.name}`);
  assert.equal(uploaded.size, file.bytes);
}
assertDraftRelease(await releaseRequest(`/repos/${repository}/releases/${release.id}`));
console.log(`Draft ready for manual review: ${release.html_url}`);
if (process.env.GITHUB_STEP_SUMMARY)
  fs.appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `\nDraft ready for manual review: ${release.html_url}\n\nAll ${files.length} assets retain the verified bytes. No release was published automatically.\n`,
  );
