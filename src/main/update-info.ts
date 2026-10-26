import type { UpdateInfo } from "electron-updater";
import type { DesktopUpdateState } from "../contract/desktop";

const MAX_RELEASE_NOTES_LENGTH = 12_000;

export type UpdateDetails = Pick<
  DesktopUpdateState,
  "availableVersion" | "releaseName" | "releaseDate" | "releaseNotes" | "checkedAt" | "total"
>;

export interface UpdateTarget {
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
}

function decodeHtmlEntities(value: string): string {
  const entities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(/&(#(?:x[0-9a-f]+|\d+)|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const isHex = entity[1]?.toLowerCase() === "x";
      const parsed = Number.parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return Number.isFinite(parsed) && parsed >= 0 && parsed <= 0x10ffff ? String.fromCodePoint(parsed) : match;
    }
    return entities[entity.toLowerCase()] ?? match;
  });
}

function plainText(value: string, maxLength = MAX_RELEASE_NOTES_LENGTH): string | undefined {
  const decoded = decodeHtmlEntities(value);
  const result = decoded
    .replace(/<\s*(script|style|iframe|object)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\r/g, "")
    .replace(/[\t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!result) return undefined;
  return result.length > maxLength ? `${result.slice(0, maxLength)}…` : result;
}

function releaseNotesToText(notes: UpdateInfo["releaseNotes"]): string | undefined {
  if (typeof notes === "string") return plainText(notes);
  if (!Array.isArray(notes)) return undefined;
  const entries = notes.flatMap((entry) => {
    const note = plainText(entry.note ?? "");
    if (!note) return [];
    const version = plainText(entry.version, 80);
    return [version ? `${version}\n${note}` : note];
  });
  return plainText(entries.join("\n\n"));
}

function safeDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

export function finiteNonNegative(value: number): number | undefined {
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function packageSize(files: UpdateInfo["files"], target: UpdateTarget): number | undefined {
  const extension = target.platform === "win32" ? ".exe" : ".zip";
  const packages = (files ?? []).filter((file) => file.url.toLowerCase().endsWith(extension));
  const isArm64 = (file: UpdateInfo["files"][number]) => file.url.includes("arm64");
  const chosen =
    target.arch === "arm64" && packages.some(isArm64)
      ? packages.find(isArm64)
      : packages.find((file) => !isArm64(file));
  const size = chosen?.size;
  return size !== undefined && Number.isFinite(size) && size > 0 ? size : undefined;
}

export function availableUpdateDetails(info: UpdateInfo, checkedAt: string, target: UpdateTarget): UpdateDetails {
  return {
    availableVersion: plainText(info.version, 80),
    releaseName: info.releaseName ? plainText(info.releaseName, 300) : undefined,
    releaseDate: safeDate(info.releaseDate),
    releaseNotes: releaseNotesToText(info.releaseNotes),
    checkedAt,
    total: packageSize(info.files, target),
  };
}

export function downloadedUpdateDetails(
  info: UpdateInfo,
  previous: UpdateDetails,
  target: UpdateTarget,
): UpdateDetails {
  return {
    ...previous,
    availableVersion: plainText(info.version, 80) ?? previous.availableVersion,
    releaseName: info.releaseName ? plainText(info.releaseName, 300) : previous.releaseName,
    releaseDate: safeDate(info.releaseDate) ?? previous.releaseDate,
    releaseNotes: releaseNotesToText(info.releaseNotes) ?? previous.releaseNotes,
    total: packageSize(info.files, target) ?? previous.total,
  };
}
