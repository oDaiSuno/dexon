import type { PluginPackageInfo } from "@/lib/api-types";

export type Translate = (key: string, fallback: string) => string;

export type PluginScope = PluginPackageInfo["scope"];
export type PluginAction = "install" | "remove" | "update" | "disable" | "enable";
export type PendingCapabilityOperation =
  | { kind: "action"; action: PluginAction; pkg: PluginPackageInfo }
  | { kind: "install"; source: string; scope: PluginScope };

export function shortenPath(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}

export function packageKey(pkg: Pick<PluginPackageInfo, "source" | "scope">): string {
  return `${pkg.scope}\0${pkg.source}`;
}

export function pluginScopeLabel(scope: PluginScope, t: Translate): string {
  return scope === "project" ? t("pluginScopeProject", "project") : t("pluginScopeGlobal", "global");
}

export function installLocation(scope: PluginScope, cwd: string): string {
  return scope === "project" ? `${shortenPath(cwd)}/.pi/agent/{npm,git}` : "~/.pi/agent/{npm,git}";
}

export function findInstalledPackage(
  packages: PluginPackageInfo[],
  source: string,
  scope: PluginScope,
): PluginPackageInfo | undefined {
  const trimmed = source.trim();
  const withoutNpmPrefix = trimmed.startsWith("npm:") ? trimmed.slice(4) : trimmed;
  return (
    packages.find((pkg) => pkg.scope === scope && pkg.source === trimmed) ??
    packages.find((pkg) => pkg.scope === scope && pkg.source === `npm:${withoutNpmPrefix}`) ??
    packages.find((pkg) => pkg.scope === scope && pkg.source.endsWith(trimmed))
  );
}

export function statusColor(status: PluginPackageInfo["status"]): string {
  if (status === "loaded") return "var(--fx-accent-blue)";
  if (status === "installed") return "var(--fx-status-warning)";
  if (status === "disabled") return "var(--fx-text-tertiary)";
  return "var(--fx-status-danger)";
}

export function safePluginError(message: string | undefined, fallback: string, t: Translate): string {
  if (!message) return fallback;
  if (/ENOENT|spawn\s+(?:npm|npx|node|git)|not found/i.test(message)) {
    return t(
      "pluginDeveloperToolUnavailable",
      "A required developer tool is unavailable. Rescan tools or install the matching Essentials profile.",
    );
  }
  if (/failed to fetch|network\s*error|load failed/i.test(message)) return fallback;
  return message;
}

export function pluginRequestError(error: unknown, fallback: string): string {
  if (error instanceof TypeError) return fallback;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
