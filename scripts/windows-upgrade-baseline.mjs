export function validateUpgradeBaseline(baseline, currentVersion, repository, allowSameVersion = false) {
  if (
    !baseline ||
    !/^\d+\.\d+\.\d+$/.test(baseline.version) ||
    baseline.repository !== repository ||
    baseline.installer !== `Dexon-Unsigned-Beta-Setup-${baseline.version}.exe` ||
    !/^[a-f0-9]{64}$/.test(baseline.sha256) ||
    (baseline.helperSha256 !== null && !/^[a-f0-9]{64}$/.test(baseline.helperSha256))
  ) {
    throw new Error("Invalid Windows upgrade baseline");
  }
  if (!/^\d+\.\d+\.\d+$/.test(currentVersion)) throw new Error("Invalid current release version");
  const previous = baseline.version.split(".").map(Number);
  const current = currentVersion.split(".").map(Number);
  const difference = current.map((value, index) => value - previous[index]).find((value) => value !== 0) ?? 0;
  if (difference < 0 || (difference === 0 && !allowSameVersion)) {
    throw new Error(
      "The upgrade baseline must be older than the release; same-version replacement is only an explicit CI rehearsal",
    );
  }
  return difference === 0 ? "same-version-replacement" : "upgrade";
}
