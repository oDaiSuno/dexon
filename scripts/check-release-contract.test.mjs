import assert from "node:assert/strict";
import test from "node:test";
import { validateReleaseVersion } from "./check-release-contract.mjs";

const packageJson = { version: "0.1.1" };
const lock = { version: "0.1.1", packages: { "": { version: "0.1.1" } } };

test("a release tag cannot publish a different package version or an inconsistent lockfile", () => {
  for (const [pkg, dependencyLock, tag] of [
    [packageJson, lock, "main"],
    [packageJson, lock, "v0.1.0"],
    [{ version: "0.1.1-beta.1" }, lock, "v0.1.1-beta.1"],
    [packageJson, { ...lock, version: "0.1.0" }, "v0.1.1"],
    [packageJson, { ...lock, packages: {} }, "v0.1.1"],
  ])
    assert.throws(() => validateReleaseVersion(pkg, dependencyLock, tag), /version|tag/);
});

test("a new stable version with matching package and lockfile can proceed", () => {
  validateReleaseVersion(packageJson, lock, "v0.1.1");
});
