import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  artifactIdentity,
  createArtifactManifest,
  stageArtifacts,
  verifyArtifactManifest,
} from "./release-artifacts.mjs";
import { assertSuccessfulSpawn } from "./process-utils.mjs";
import { verifyUpdateConfiguration } from "./verify-update-configuration.mjs";
import { verifyUpdateMetadata } from "./verify-update-metadata.mjs";
import { validateUpgradeBaseline } from "./windows-upgrade-baseline.mjs";

const [target, mode, directoryArgument = "dist", ...extra] = process.argv.slice(2);
if (
  !/^(?:darwin-(?:arm64|x64)|win32-x64|linux-x64)$/.test(target) ||
  !["--ci", "--release"].includes(mode) ||
  extra.length
) {
  throw new Error("Usage: verify-distribution.mjs <target> <--ci|--release> [directory]");
}
assert.equal(target, `${process.platform}-${process.arch}`, "Final packages must execute on their native target");
const root = path.resolve(import.meta.dirname, "..");
const directory = path.resolve(directoryArgument);
const release = mode === "--release";
const mac = process.platform === "darwin";
const manifestTarget = mac && release ? "darwin" : target;
const signing = mac
  ? release
    ? "unsigned-beta"
    : "unsigned-ci"
  : process.platform === "win32"
    ? "unsigned-beta"
    : "unsigned";
const identity = artifactIdentity(manifestTarget, signing);
const manifestFile = path.join(directory, `${manifestTarget}.manifest.json`);
const manifest =
  mac && release
    ? JSON.parse(fs.readFileSync(manifestFile, "utf8"))
    : await createArtifactManifest(directory, identity);
await verifyArtifactManifest(directory, manifest, identity);
const metadata = mac ? "latest-mac.yml" : process.platform === "win32" ? "latest.yml" : "latest-linux.yml";
await verifyUpdateMetadata(
  path.join(directory, metadata),
  identity.version,
  manifest.files
    .filter(({ name }) => /\.(?:dmg|zip|exe|AppImage)$/.test(name))
    .map(({ name }) => path.join(directory, name)),
);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "dexon-final-package-"));

function run(command, args, options = {}) {
  console.log(`[distribution] ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", timeout: 240_000, ...options });
  if (result.status !== 0 && result.stderr) console.error(String(result.stderr));
  return assertSuccessfulSpawn(result, command);
}

function verifyApplication(container, resources) {
  verifyUpdateConfiguration(fs.readFileSync(path.join(resources, "app-update.yml"), "utf8"), identity.repository);
  run(process.execPath, [
    "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    "scripts/verify-packaged-toolchains.mjs",
    target,
    container,
  ]);
}

function verifyMacApplication(container) {
  const app = path.join(container, "Dexon.app");

  verifyApplication(container, path.join(app, "Contents/Resources"));
}

let installerScenario;
try {
  if (mac) {
    const architecture = target.split("-")[1];
    const archive = path.join(directory, `Dexon-${identity.version}-${architecture}.zip`);
    const extracted = path.join(temporary, "zip");
    run("ditto", ["-x", "-k", archive, extracted]);
    verifyMacApplication(extracted);
    const mount = path.join(temporary, "dmg");
    fs.mkdirSync(mount);
    run("hdiutil", [
      "attach",
      "-readonly",
      "-nobrowse",
      "-mountpoint",
      mount,
      path.join(directory, `Dexon-${identity.version}-${architecture}.dmg`),
    ]);
    try {
      verifyMacApplication(mount);
    } finally {
      run("hdiutil", ["detach", mount]);
    }
  } else if (process.platform === "linux") {
    const name = `Dexon-${identity.version}-x86_64.AppImage`;
    const image = path.join(temporary, name);
    fs.copyFileSync(path.join(directory, name), image);
    fs.chmodSync(image, 0o755);
    run(image, ["--appimage-extract"], {
      cwd: temporary,
      stdio: "pipe",
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    const unpacked = path.join(temporary, "linux-unpacked");
    fs.renameSync(path.join(temporary, "squashfs-root"), unpacked);
    const sandbox = path.join(unpacked, "chrome-sandbox");
    run("sudo", ["chown", "root:root", sandbox]);
    run("sudo", ["chmod", "4755", sandbox]);
    verifyApplication(temporary, path.join(unpacked, "resources"));
  } else {
    const baselineFile = path.join(root, ".github/windows-upgrade-baseline.json");
    const baseline = JSON.parse(fs.readFileSync(baselineFile, "utf8"));
    installerScenario = validateUpgradeBaseline(baseline, identity.version, identity.repository, !release);
    const previous = path.join(temporary, baseline.installer);
    const url = `https://github.com/${baseline.repository}/releases/download/v${baseline.version}/${baseline.installer}`;
    run("curl.exe", ["--fail", "--location", "--retry", "3", "--output", previous, url]);
    assert.equal(
      createHash("sha256").update(fs.readFileSync(previous)).digest("hex"),
      baseline.sha256,
      "Previous installer hash mismatch",
    );
    const current = path.join(directory, `Dexon-Unsigned-Beta-Setup-${identity.version}.exe`);
    const escaped = current.replaceAll("'", "''");
    run("pwsh", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$ErrorActionPreference='Stop'; $signature=Get-AuthenticodeSignature -LiteralPath '${escaped}'; if ($signature.Status -ne 'NotSigned') { throw 'Expected an explicitly unsigned Windows Beta installer' }`,
    ]);
    run(
      process.execPath,
      ["scripts/test-windows-nsis-upgrade.mjs", previous, current, ...(!release ? ["--allow-same-version"] : [])],
      { timeout: 900_000 },
    );
    run(process.execPath, ["scripts/test-windows-nsis-user-files.mjs", previous, current], { timeout: 900_000 });
    run(process.execPath, ["scripts/test-windows-nsis-install-guard.mjs", previous, current], { timeout: 900_000 });
    run(process.execPath, ["scripts/test-windows-nsis-directory-page.mjs", previous, current], { timeout: 900_000 });
  }
  await verifyArtifactManifest(directory, manifest, identity);
  if (!(mac && release)) {
    fs.mkdirSync(".artifacts/distribution", { recursive: true });
    await stageArtifacts(directory, path.join(".artifacts/distribution", manifestTarget), manifest);
  }
  fs.mkdirSync(".artifacts/distribution-evidence", { recursive: true });
  fs.writeFileSync(
    path.join(".artifacts/distribution-evidence", `${target}.json`),
    JSON.stringify(
      {
        pass: true,
        target,
        identity,
        files: manifest.files,
        installerScenario,
        boundary: mac
          ? "final ZIP and mounted DMG"
          : process.platform === "win32"
            ? "installed NSIS package, previous installer and rollback, user files, refusal, busy files, other drive, directory page"
            : "extracted final AppImage with SUID sandbox; AppImage entry uses extraction mode without sandbox",
        inAppUpdateDiscoveryTested: false,
      },
      null,
      2,
    ),
  );
  console.log(`[distribution] ${target}: final files accepted without rebuilding or resigning`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
