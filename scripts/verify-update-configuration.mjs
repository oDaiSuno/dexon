import YAML from "yaml";

export function verifyUpdateConfiguration(document, repository) {
  const configuration = YAML.parse(document);
  const [owner, repo] = repository.split("/");
  if (
    !configuration ||
    configuration.provider !== "github" ||
    configuration.owner !== owner ||
    configuration.repo !== repo
  ) {
    throw new Error("Packaged update configuration must use the official release repository");
  }
  if (
    /https?:\/\/[^/\s:@]+:[^@\s/]+@|\b(?:Basic|Bearer)\s+[A-Za-z0-9+/_.=-]{8,}|\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/i.test(
      document,
    )
  ) {
    throw new Error("Packaged update configuration contains a credential-bearing value");
  }
  const allowed = new Set(["provider", "owner", "repo", "releaseType", "updaterCacheDirName"]);
  for (const key of Object.keys(configuration ?? {})) {
    if (!allowed.has(key)) throw new Error(`Unexpected or forbidden update setting: ${key}`);
  }
}
