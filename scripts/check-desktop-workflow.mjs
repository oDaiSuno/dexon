#!/usr/bin/env node
/**
 * 桌面 CI 工作流不变量 —— 原 desktop-workflow.test.mjs 迁入（切片四批，2026-10-13）。
 *
 * 这些规则保护的是发布流水线的形状：四个桌面目标必须全打包、Windows 必须
 * 跑纯质量检查而不依赖 Xvfb、更新元数据必须逐平台交叉核对、未签名 Windows
 * 包必须明示 Beta、SBOM 与第三方声明必须随包。它们是 CI 配置的静态契约，
 * 没有本地可观察的行为，属于 check:production-artifacts 家族。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflow = YAML.parse(readFileSync(path.join(root, ".github", "workflows", "build-desktop.yml"), "utf8"));
const builderConfig = readFileSync(path.join(root, "electron-builder.yml"), "utf8");
const failures = [];

function step(jobName, stepName) {
  const step = workflow.jobs[jobName]?.steps?.find((candidate) => candidate.name === stepName);
  if (!step) failures.push(`${jobName} is missing step: ${stepName}`);
  return step;
}

// —— 发布触发与四目标打包矩阵（原 "main pushes package every supported desktop target"）
function checkReleaseMatrix() {
  const push = workflow.on?.push;
  if (JSON.stringify(push?.branches) !== JSON.stringify(["main"])) failures.push("push branches must be [main]");
  if (JSON.stringify(push?.tags) !== JSON.stringify(["v*"])) failures.push("push tags must be [v*]");
  if (!("workflow_dispatch" in workflow.on)) failures.push("manual workflow_dispatch runs must stay available");
  if (workflow.jobs.package?.if !== "github.ref_type != 'tag'") {
    failures.push("package job must skip tag pushes (the tag pipeline packages signed artifacts)");
  }
  const targets = workflow.jobs.package?.strategy?.matrix?.include?.map(({ tool_target }) => tool_target);
  if (JSON.stringify(targets) !== JSON.stringify(["darwin-arm64", "darwin-x64", "win32-x64", "linux-x64"])) {
    failures.push(`package matrix tool_targets must cover all four desktop targets, found: ${JSON.stringify(targets)}`);
  }
  for (const [stepName, pattern] of [
    ["Verify packaged toolchains and production startup (macOS)", /check:packaged-toolchains/],
    ["Verify packaged toolchains and production startup (Windows)", /check:packaged-toolchains.*--release-helper/],
    ["Verify packaged toolchains and production startup (Linux)", /check:packaged-toolchains/],
  ]) {
    const verify = step("package", stepName);
    if (verify && !pattern.test(verify.run)) failures.push(`${stepName} must run the packaged-toolchain check`);
  }
}

// —— Windows 质量门：纯静态检查 + Electron 冒烟，不依赖 Xvfb（原第 2 个测试）
function checkWindowsQuality() {
  const windows = workflow.jobs["test-platforms"]?.strategy?.matrix?.include?.find(
    ({ name }) => name === "Windows x64",
  );
  if (!windows) {
    failures.push("test-platforms matrix must include a Windows x64 entry");
    return;
  }
  if (windows.runner !== "windows-2025") failures.push("Windows x64 must run on windows-2025");
  if (windows.timeout_minutes !== 45) failures.push("Windows x64 timeout must stay 45 minutes");
  if (workflow.jobs["test-platforms"]["timeout-minutes"] !== "${{ matrix.timeout_minutes }}") {
    failures.push("test-platforms timeout must delegate to the matrix");
  }
  const helperAcceptance = step("test-platforms", "Validate Windows managed process helper");
  if (helperAcceptance) {
    if (!/PI_WINDOWS_HELPER_HANDLE_LOOPS = "100"/.test(helperAcceptance.run)) {
      failures.push("Windows helper acceptance must run the 100-handle-loop budget");
    }
    if (!/PSNativeCommandUseErrorActionPreference = \$true/.test(helperAcceptance.run)) {
      failures.push("Windows helper acceptance must enable strict PowerShell error handling");
    }
  }
  const install = step("test-platforms", "Install Electron binary (Windows)");
  if (install && install.if !== "runner.os == 'Windows'") {
    failures.push("Electron binary install must be gated on Windows runners");
  }
  const quality = step("test-platforms", "Run cross-platform quality checks (Windows)");
  if (quality) {
    if (quality.if !== "runner.os == 'Windows'") failures.push("quality checks must be gated on Windows runners");
    for (const command of [
      "format:check",
      "lint",
      "typecheck",
      "check:dependencies",
      "check:contract",
      "check:pi-compat",
      "check:toolchain-contract",
      "check:toolchain-catalog",
      "check:browser-i18n",
    ]) {
      if (!quality.run.includes(`npm run ${command}`)) failures.push(`quality checks must run npm run ${command}`);
    }
    if (/xvfb/i.test(quality.run)) failures.push("Windows quality checks must not depend on Xvfb");
  }
  const smoke = step("package", "Run Electron smoke on Windows");
  if (smoke) {
    if (smoke.if !== "runner.os == 'Windows'") failures.push("Electron smoke must be gated on Windows runners");
    if (smoke.run !== "npm run smoke") failures.push("Electron smoke must run npm run smoke");
  }
  const navigation = step("package", "Run production navigation acceptance");
  if (navigation) {
    if (navigation.if !== "runner.os != 'Linux'")
      failures.push("production navigation acceptance must run on the macOS and Windows runners");
    if (!/npm run test:app-navigation-electron/.test(navigation.run ?? ""))
      failures.push("production navigation acceptance must run npm run test:app-navigation-electron");
  }
  const packageSteps = workflow.jobs.package?.steps ?? [];
  const bundledTools = step("package", "Prepare verified bundled search tools");
  if (bundledTools && smoke && packageSteps.indexOf(bundledTools) >= packageSteps.indexOf(smoke)) {
    failures.push("bundled search tools must be prepared before Electron smoke");
  }
  const helperRebuild = step("package", "Rebuild authoritative Windows helper for packaging");
  const packageStep = step("package", "Package ${{ matrix.name }}");
  if (helperRebuild && packageStep && packageSteps.indexOf(helperRebuild) >= packageSteps.indexOf(packageStep)) {
    failures.push("the authoritative Windows helper must replace the development build before packaging");
  }
}

// —— 更新元数据逐平台交叉核对（原第 3 个测试）
function checkUpdateMetadata() {
  const verification = step("package", "Verify update metadata matches the packaged architecture");
  if (!verification) return;
  for (const metadata of ["latest-mac.yml", "latest.yml", "latest-linux.yml"]) {
    if (!verification.run.includes(metadata)) failures.push(`update metadata verification must cover ${metadata}`);
  }
  for (const artifact of [
    "${{ matrix.arch }}.dmg",
    "${{ matrix.arch }}.zip",
    "Unsigned-Beta-Setup-${version}.exe",
    "x86_64.AppImage",
  ]) {
    if (!verification.run.includes(artifact)) failures.push(`update metadata verification must cover ${artifact}`);
  }
  if (!/verify-update-metadata\.mjs "\$metadata" "\$version" "\$\{update_artifacts\[@\]\}"/.test(verification.run)) {
    failures.push("update metadata verification must invoke verify-update-metadata.mjs with the packaged artifacts");
  }
}

// —— 未签名 Windows 包必须明示 Beta（原第 4 个测试）
function checkUnsignedBetaStatus() {
  const windowsRelease = workflow.jobs["release-windows"];
  if (!windowsRelease) {
    failures.push("workflow must keep the unsigned Windows release job");
    return;
  }
  if (!/Unsigned Beta/.test(windowsRelease.name ?? "")) {
    failures.push("unsigned Windows releases must be named Unsigned Beta");
  }
  if (windowsRelease.env?.CSC_IDENTITY_AUTO_DISCOVERY !== "false") {
    failures.push("unsigned Windows releases must disable automatic code-signing discovery");
  }
  const trustGate = step("release-windows", "Enforce unsigned Windows Beta trust status");
  if (trustGate) {
    if (trustGate.shell !== "pwsh") failures.push("the Beta trust gate must run under pwsh");
    for (const marker of ["Get-AuthenticodeSignature", "NotSigned", "Unknown Publisher"]) {
      if (!trustGate.run.includes(marker)) failures.push(`the Beta trust gate must check ${marker}`);
    }
    if (!trustGate.run.includes("certificate-backed signing and provenance verification")) {
      failures.push("the Beta trust gate must point to the certificate-backed signing exit");
    }
  }
  if (!builderConfig.includes("artifactName: Dexon-Unsigned-Beta-Setup-${version}.${ext}")) {
    failures.push("electron-builder must keep the Unsigned Beta artifact name");
  }
}

// —— Windows 包必须携带 SBOM 与第三方声明（原第 5 个测试）
function checkSbomAndNotices() {
  for (const jobName of ["package", "release-windows"]) {
    const gate = step(jobName, "Generate and verify Windows SBOM");
    if (gate) {
      if (!gate.run.includes("npm run build:windows-sbom")) {
        failures.push(`${jobName} must build the Windows SBOM`);
      }
      if (!gate.run.includes("npm run check:windows-sbom")) {
        failures.push(`${jobName} must verify the Windows SBOM`);
      }
    }
  }
  const windowsUpload = step("release-windows", "Upload Windows release artifacts")?.with?.path;
  if (!windowsUpload || !/dist\/\*\.cdx\.json/.test(windowsUpload) || !/THIRD_PARTY_NOTICES\.md/.test(windowsUpload)) {
    failures.push("Windows release uploads must include the SBOM and the third-party notices");
  }
  const release = step("release", "Create or update draft release");
  if (release) {
    for (const marker of ["-name '*.cdx.json'", "-name 'THIRD_PARTY_NOTICES.md'"]) {
      if (!release.run.includes(marker)) failures.push(`draft releases must collect ${marker}`);
    }
    if (!release.run.includes(`find "$windows_artifacts" -type f -name '*.cdx.json'`)) {
      failures.push("draft releases must re-collect SBOMs from the Windows artifact set");
    }
  }
}

checkReleaseMatrix();
checkWindowsQuality();
checkUpdateMetadata();
checkUnsignedBetaStatus();
checkSbomAndNotices();

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}
console.log(
  "OK: desktop CI workflow keeps the four-target matrix, Windows quality gate, update metadata checks, unsigned Beta status, and SBOM/notices requirements",
);
