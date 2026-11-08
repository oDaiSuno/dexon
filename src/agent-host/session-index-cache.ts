import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { SessionInfo } from "../shared/types";
import { atomicWriteText, desktopUserDataPath } from "./desktop-state-file";

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

interface SessionIndexCacheFile {
  version: 1;
  records: Record<string, PersistedIndexRecord>;
}

function cacheFilePath(): string {
  return path.join(desktopUserDataPath(), "session-index-cache.json");
}

export function fingerprint(filePath: string): Fingerprint {
  const stat = statSync(filePath);
  return { size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, ino: stat.ino };
}

export function readFingerprintOrNull(filePath: string): Fingerprint | null {
  try {
    return fingerprint(filePath);
  } catch {
    return null;
  }
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

function toPersistedSessionInfo(info: SessionInfo | null): SessionInfo | null {
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

function normalizePersistedRecord(rawPath: string, value: unknown): PersistedIndexRecord | undefined {
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

export function loadSessionIndexCache(): PersistedIndexRecord[] {
  try {
    const raw = JSON.parse(readFileSync(cacheFilePath(), "utf8")) as Partial<SessionIndexCacheFile>;
    if (raw?.version !== 1 || !raw.records || typeof raw.records !== "object" || Array.isArray(raw.records)) {
      return [];
    }
    const records: PersistedIndexRecord[] = [];
    for (const [key, value] of Object.entries(raw.records)) {
      const record = normalizePersistedRecord(key, value);
      if (record) records.push(record);
    }
    return records;
  } catch {
    return [];
  }
}

export function saveSessionIndexCache(records: Iterable<PersistedIndexRecord>): void {
  const payload: SessionIndexCacheFile = { version: 1, records: {} };
  for (const record of records) {
    payload.records[record.filePath] = {
      filePath: record.filePath,
      fingerprint: record.fingerprint,
      info: toPersistedSessionInfo(record.info),
      ...(record.parentPath ? { parentPath: record.parentPath } : {}),
      valid: record.valid,
    };
  }
  try {
    atomicWriteText(cacheFilePath(), JSON.stringify(payload));
  } catch (error) {
    console.error("[agent-host] failed to flush session index cache:", error);
  }
}
