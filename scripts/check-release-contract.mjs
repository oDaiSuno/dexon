import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertDraftRelease, getExistingRelease, releaseRequest } from "./github-release.mjs";
import { assertSuccessfulSpawn } from "./process-utils.mjs";
import { validateUpgradeBaseline } from "./windows-upgrade-baseline.mjs";

export function validateReleaseVersion(packageJson, packageLock, tag) {
  assert.match(packageJson.version, /^\d+\.\d+\.\d+$/, "Stable release version must be x.y.z");
  assert.equal(tag, `v${packageJson.version}`, "Release tag must exactly match the package version");
  assert.equal(packageLock.version, packageJson.version, "Lockfile version must match the package version");
  assert.equal(
    packageLock.packages?.[""]?.version,
    packageJson.version,
    "Locked root version must match the package version",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
  validateReleaseVersion(
    packageJson,
    JSON.parse(fs.readFileSync("package-lock.json", "utf8")),
    process.env.GITHUB_REF_NAME,
  );
  assert.equal(process.env.GITHUB_REF_TYPE, "tag", "Releases must run on an existing version tag");
  for (const args of [
    ["fetch", "--no-tags", "origin", "main:refs/remotes/origin/main"],
    ["merge-base", "--is-ancestor", process.env.GITHUB_SHA, "origin/main"],
  ]) {
    assertSuccessfulSpawn(spawnSync("git", args, { stdio: "inherit" }), "Release commit must belong to main");
  }
  const repository = process.env.GITHUB_REPOSITORY;
  await releaseRequest(`/repos/${repository}`);
  const existing = await getExistingRelease(repository, process.env.GITHUB_REF_NAME);
  if (existing) assertDraftRelease(existing);
  const baseline = JSON.parse(fs.readFileSync(".github/windows-upgrade-baseline.json", "utf8"));
  validateUpgradeBaseline(baseline, packageJson.version, repository);
  const latest = await releaseRequest(`/repos/${repository}/releases/latest`);
  assert.equal(
    latest.tag_name,
    `v${baseline.version}`,
    "Review and update the Windows upgrade baseline to the latest public stable release",
  );
  console.log(
    `Validated ${process.env.GITHUB_REF_NAME}: main ancestry, version, public-release protection and upgrade baseline`,
  );
}
