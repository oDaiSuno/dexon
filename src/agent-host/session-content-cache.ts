import fs from "node:fs/promises";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { SessionEntry } from "../shared/types";
import { readSessionFileEntries } from "./session-jsonl";

const MAX_CACHED_SESSIONS = 2;
const MAX_CACHED_FILE_BYTES = 128 * 1024 * 1024;

export interface SessionContentFingerprint {
  dev: number;
  birthtimeMs: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  ino: number;
}

export interface SessionContentSnapshot {
  manager: SessionManager;
  entries: SessionEntry[];
  fingerprint: SessionContentFingerprint;
}

interface CacheRecord extends SessionContentSnapshot {
  filePath: string;
}

const cache = new Map<string, CacheRecord>();
let cachedFileBytes = 0;

async function fingerprint(filePath: string): Promise<SessionContentFingerprint> {
  const { size, mtimeMs, ctimeMs, ino, dev, birthtimeMs } = await fs.stat(filePath);
  return { size, mtimeMs, ctimeMs, ino, dev, birthtimeMs };
}

function fingerprintsEqual(left: SessionContentFingerprint, right: SessionContentFingerprint): boolean {
  return (
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.ino === right.ino &&
    left.dev === right.dev &&
    left.birthtimeMs === right.birthtimeMs
  );
}

function removeRecord(filePath: string): void {
  const existing = cache.get(filePath);
  if (!existing) return;
  cachedFileBytes -= existing.fingerprint.size;
  cache.delete(filePath);
}

function evictIfNeeded(): void {
  while (cache.size > MAX_CACHED_SESSIONS || cachedFileBytes > MAX_CACHED_FILE_BYTES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) break;
    removeRecord(oldest);
  }
}

async function readSnapshot(filePath: string, isCurrent: () => boolean): Promise<SessionContentSnapshot> {
  const currentFingerprint = await fingerprint(filePath);
  const existing = cache.get(filePath);
  if (existing && fingerprintsEqual(existing.fingerprint, currentFingerprint)) {
    cache.delete(filePath);
    cache.set(filePath, existing);
    return existing;
  }
  if (isCurrent()) removeRecord(filePath);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const before = await fingerprint(filePath);
    const manager = SessionManager.inMemory(
      undefined,
      undefined,
      await readSessionFileEntries(filePath, { maxBytes: before.size }),
    );
    const entries = manager.getEntries() as unknown as SessionEntry[];
    const after = await fingerprint(filePath);
    if (
      after.ino !== before.ino ||
      after.dev !== before.dev ||
      after.birthtimeMs !== before.birthtimeMs ||
      after.size < before.size
    ) {
      if (attempt === 0) continue;
      throw new Error("Session changed while it was being read");
    }
    const record: CacheRecord = { filePath, manager, entries, fingerprint: before };
    if (isCurrent()) {
      removeRecord(filePath);
      cache.set(filePath, record);
      cachedFileBytes += before.size;
      evictIfNeeded();
    }
    return record;
  }
  throw new Error("Unable to read a stable session snapshot");
}

const pending = new Map<string, Promise<SessionContentSnapshot>>();

export function getSessionContentSnapshot(filePath: string): Promise<SessionContentSnapshot> {
  const existing = pending.get(filePath);
  if (existing) return existing;
  const reading: Promise<SessionContentSnapshot> = readSnapshot(
    filePath,
    () => pending.get(filePath) === reading,
  ).finally(() => {
    if (pending.get(filePath) === reading) pending.delete(filePath);
  });
  pending.set(filePath, reading);
  return reading;
}

export function invalidateSessionContent(filePath: string): void {
  pending.delete(filePath);
  removeRecord(filePath);
}
