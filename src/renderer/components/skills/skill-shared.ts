import type { SkillRecord } from "@/lib/api-types";

export type Translate = (key: string, fallback: string) => string;

export type Skill = SkillRecord;

export function shortenPath(p: string): string {
  // Match common home dir patterns: /Users/xxx, /home/xxx
  return p.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}

export function sourceLabel(skill: Skill): string {
  const src = skill.sourceInfo?.source;
  const scope = skill.sourceInfo?.scope;
  if (scope === "user" || src === "user") return "global";
  if (scope === "project" || src === "project") return "project";
  return "path";
}

export function sourceLabelText(label: string, t: Translate): string {
  if (label === "global") return t("skillScopeGlobal", "global");
  if (label === "project") return t("skillScopeProject", "project");
  return t("skillScopePath", "path");
}

export function safeInstallError(message: string | undefined, fallback: string, t: Translate): string {
  if (!message) return fallback;
  if (/ENOENT|spawn\s+(?:npm|npx|node)|not found/i.test(message)) {
    return t(
      "skillDeveloperToolUnavailable",
      "A required developer tool is unavailable. Rescan tools or install JavaScript Essentials.",
    );
  }
  if (/failed to fetch|network\s*error|load failed/i.test(message)) return fallback;
  return message;
}

export function requestErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof TypeError) return fallback;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
