import { statSync } from "node:fs";
import type { SessionInfo } from "../shared/types";

export interface Fingerprint {
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  ino: number;
}

export interface PersistedIndexRecord {
  filePath: string;
  fingerprint: Fingerprint;
  info: SessionInfo | null;
  parentPath?: string;
  valid: boolean;
}

export function fingerprint(filePath: string): Fingerprint {
  const stat = statSync(filePath);
  return { size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, ino: stat.ino };
}

export function readFingerprintOrNull(filePath: string): Fingerprint | null {
  try {
    return fingerprint(filePath);
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

export function isMissingFile(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

export function sameFingerprint(left: Fingerprint, right: Fingerprint): boolean {
  return (
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.ino === right.ino
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeFingerprint(value: unknown): Fingerprint | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    !isFiniteNumber(candidate.size) ||
    !isFiniteNumber(candidate.mtimeMs) ||
    !isFiniteNumber(candidate.ctimeMs) ||
    !isFiniteNumber(candidate.ino)
  ) {
    return undefined;
  }
  return {
    size: candidate.size,
    mtimeMs: candidate.mtimeMs,
    ctimeMs: candidate.ctimeMs,
    ino: candidate.ino,
  };
}

export function toPersistedSessionInfo(info: SessionInfo | null): SessionInfo | null {
  if (!info) return null;
  return {
    path: info.path,
    id: info.id,
    cwd: info.cwd,
    ...(typeof info.name === "string" && info.name ? { name: info.name } : {}),
    created: info.created,
    modified: info.modified,
    messageCount: info.messageCount,
    firstMessage: info.firstMessage,
  };
}

function normalizeSessionInfo(value: unknown): SessionInfo | null | undefined {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.path !== "string" ||
    typeof candidate.id !== "string" ||
    typeof candidate.cwd !== "string" ||
    typeof candidate.created !== "string" ||
    typeof candidate.modified !== "string" ||
    typeof candidate.firstMessage !== "string" ||
    !isFiniteNumber(candidate.messageCount)
  ) {
    return undefined;
  }
  return toPersistedSessionInfo({
    path: candidate.path,
    id: candidate.id,
    cwd: candidate.cwd,
    name: typeof candidate.name === "string" ? candidate.name : undefined,
    created: candidate.created,
    modified: candidate.modified,
    messageCount: candidate.messageCount,
    firstMessage: candidate.firstMessage,
  });
}

export function normalizePersistedRecord(rawPath: string, value: unknown): PersistedIndexRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const filePath = (typeof candidate.filePath === "string" && candidate.filePath.trim()) || rawPath.trim();
  const normalizedFingerprint = normalizeFingerprint(candidate.fingerprint);
  if (!filePath || !normalizedFingerprint || typeof candidate.valid !== "boolean") return undefined;
  const info = normalizeSessionInfo(candidate.info);
  if (info === undefined || (candidate.valid && !info)) return undefined;
  const parentPath = typeof candidate.parentPath === "string" ? candidate.parentPath.trim() : undefined;
  return {
    filePath,
    fingerprint: normalizedFingerprint,
    info: candidate.valid ? info : null,
    ...(parentPath ? { parentPath } : {}),
    valid: candidate.valid,
  };
}

export function toPersistedRecord(record: PersistedIndexRecord): PersistedIndexRecord {
  return {
    filePath: record.filePath,
    fingerprint: record.fingerprint,
    info: toPersistedSessionInfo(record.info),
    ...(record.parentPath ? { parentPath: record.parentPath } : {}),
    valid: record.valid,
  };
}

export function parseLegacyCache(text: string): PersistedIndexRecord[] {
  const raw = JSON.parse(text) as { version?: unknown; records?: unknown };
  if (raw?.version !== 1 || !raw.records || typeof raw.records !== "object" || Array.isArray(raw.records)) {
    throw new Error("Invalid session index cache");
  }
  const records: PersistedIndexRecord[] = [];
  for (const [key, value] of Object.entries(raw.records)) {
    const record = normalizePersistedRecord(key, value);
    if (record) records.push(record);
  }
  return records;
}
