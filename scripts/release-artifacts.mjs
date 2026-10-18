import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function artifactNames(target, version) {
  if (!/^(?:darwin(?:-(?:arm64|x64))?|win32-x64|linux-x64)$/.test(target)) {
    throw new Error(`Unsupported artifact target: ${target}`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid release version: ${version}`);
  if (target === "linux-x64") return [`Dexon-${version}-x86_64.AppImage`, "latest-linux.yml"];
  if (target === "win32-x64") {
    return [
      `Dexon-Unsigned-Beta-Setup-${version}.exe`,
      `Dexon-Unsigned-Beta-Setup-${version}.exe.blockmap`,
      `Dexon-Windows-x64-${version}.cdx.json`,
      "THIRD_PARTY_NOTICES.md",
      "latest.yml",
    ];
  }
  const architectures = target === "darwin" ? ["arm64", "x64"] : [target.slice("darwin-".length)];
  return [
    ...architectures.flatMap((architecture) =>
      ["dmg", "zip"].flatMap((extension) => {
        const name = `Dexon-${version}-${architecture}.${extension}`;
        return [name, `${name}.blockmap`];
      }),
    ),
    "latest-mac.yml",
  ];
}

export async function createArtifactManifest(directory, identity) {
  for (const [field, pattern] of Object.entries({
    commit: /^[a-f0-9]{40}$/,
    runId: /^[1-9]\d*$/,
    runAttempt: /^[1-9]\d*$/,
    signing: /^(?:unsigned|unsigned-ci|unsigned-beta)$/,
  })) {
    if (!pattern.test(identity[field] ?? "")) throw new Error(`Invalid artifact identity: ${field}`);
  }
  const files = [];
  for (const name of artifactNames(identity.target, identity.version)) {
    const file = path.join(directory, name);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0) {
      throw new Error(`Artifact must be a nonempty regular file, not a link: ${name}`);
    }
    const hash = createHash("sha256");
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    files.push({ name, bytes: stat.size, sha256: hash.digest("hex") });
  }
  return { schemaVersion: 1, ...identity, files };
}

export async function verifyArtifactManifest(directory, manifest, expectedIdentity) {
  const actual = await createArtifactManifest(directory, { ...expectedIdentity, runAttempt: manifest.runAttempt });
  assert.deepEqual(manifest, actual, "Artifact manifest does not match the final files or build identity");
}

export async function stageArtifacts(directory, destination, manifest) {
  const identity = Object.fromEntries(
    Object.entries(manifest).filter(([key]) => !["schemaVersion", "files"].includes(key)),
  );
  await verifyArtifactManifest(directory, manifest, identity);
  fs.mkdirSync(destination);
  for (const file of manifest.files)
    fs.copyFileSync(path.join(directory, file.name), path.join(destination, file.name));
  await verifyArtifactManifest(destination, manifest, identity);
  fs.writeFileSync(
    path.join(destination, `${manifest.target}.manifest.json`),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

export function artifactIdentity(target, signing) {
  return {
    repository: process.env.GITHUB_REPOSITORY,
    commit: process.env.GITHUB_SHA,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    version: JSON.parse(fs.readFileSync("package.json", "utf8")).version,
    target,
    signing,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [command, target, signing, directory = "dist", ...extra] = process.argv.slice(2);
  if (!["record", "verify"].includes(command) || !target || !signing || extra.length) {
    throw new Error("Usage: release-artifacts.mjs <record|verify> <target> <signing> [directory]");
  }
  const identity = artifactIdentity(target, signing);
  if (command === "record") {
    const manifest = await createArtifactManifest(directory, identity);
    fs.mkdirSync(".artifacts/distribution", { recursive: true });
    await stageArtifacts(directory, path.join(".artifacts/distribution", target), manifest);
  } else {
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, `${target}.manifest.json`), "utf8"));
    await verifyArtifactManifest(directory, manifest, identity);
  }
}
