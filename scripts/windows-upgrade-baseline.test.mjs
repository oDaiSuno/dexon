import assert from "node:assert/strict";
import test from "node:test";
import { validateUpgradeBaseline } from "./windows-upgrade-baseline.mjs";

const baseline = {
  version: "0.1.0",
  repository: "oDaiSuno/dexon",
  installer: "Dexon-Unsigned-Beta-Setup-0.1.0.exe",
  sha256: "a".repeat(64),
  helperSha256: "b".repeat(64),
};

test("a missing or mismatched previous-release record is an error, never a first-release exemption", () => {
  for (const value of [
    null,
    {},
    { ...baseline, sha256: "" },
    { ...baseline, installer: "../installer.exe" },
    { ...baseline, repository: "different/project" },
    { ...baseline, helperSha256: "" },
  ]) {
    assert.throws(() => validateUpgradeBaseline(value, "0.1.1", "oDaiSuno/dexon"), /baseline/);
  }
});

test("release upgrades require an older baseline, while an explicit CI rehearsal may replace the same version", () => {
  assert.throws(() => validateUpgradeBaseline(baseline, "0.1.0", "oDaiSuno/dexon"), /older/);
  assert.throws(() => validateUpgradeBaseline(baseline, "0.0.9", "oDaiSuno/dexon", true), /older/);
  assert.throws(() => validateUpgradeBaseline(baseline, "invalid", "oDaiSuno/dexon"), /version/);
  assert.equal(validateUpgradeBaseline(baseline, "0.1.1", "oDaiSuno/dexon"), "upgrade");
  assert.equal(validateUpgradeBaseline(baseline, "0.1.0", "oDaiSuno/dexon", true), "same-version-replacement");
  assert.equal(validateUpgradeBaseline({ ...baseline, helperSha256: null }, "0.1.1", "oDaiSuno/dexon"), "upgrade");
});
