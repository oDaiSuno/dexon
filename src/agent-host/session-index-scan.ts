import fs from "node:fs/promises";
import path from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { SessionEntry, SessionInfo } from "../shared/types";
import { buildSessionInfoFromManager } from "./session-reader";
import {
  fingerprint,
  readFingerprintOrNull,
  sameFingerprint,
  type Fingerprint,
  type PersistedIndexRecord,
} from "./session-index-cache";
import { yieldToEventLoop } from "./session-index-journal";
import type { SessionIndexState } from "./session-index-state";

const YIELD_BUDGET_MS = 15;
const YIELD_REUSED_BATCH = 16;

export type LiveSessionSource = Pick<SessionManager, "getHeader" | "getEntries" | "getSessionName">;

export interface SavedSessionHint {
  path: string;
  fingerprint: Fingerprint;
  sessionId: string;
  source: LiveSessionSource;
  info?: SessionInfo | null;
}

export interface ReconcilePlan {
  upserts: PersistedIndexRecord[];
  removals: string[];
  filesDiscovered: number;
  filesParsed: number;
  filesReused: number;
}

export function isUnderRoot(filePath: string, root: string): boolean {
  return filePath.startsWith(`${root}${path.sep}`);
}

export async function discoverSessionFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const directories = [root];
  while (directories.length > 0) {
    const directory = directories.pop()!;
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) directories.push(candidate);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(candidate);
    }
  }
  return files;
}

export async function parseSessionFile(filePath: string, current: Fingerprint): Promise<PersistedIndexRecord> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const before = attempt === 0 ? current : fingerprint(filePath);
    try {
      const manager = SessionManager.open(filePath);
      const info = await buildSessionInfoFromManager(filePath, manager, manager.getEntries() as SessionEntry[], {
        resolveProjectInfo: false,
      });
      const after = fingerprint(filePath);
      if (!sameFingerprint(before, after)) {
        if (attempt === 0) continue;
        throw new Error("session changed during index parse");
      }
      return {
        filePath,
        fingerprint: after,
        info,
        parentPath: manager.getHeader()?.parentSession,
        valid: Boolean(info),
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code && code !== "ENOENT" && code !== "ENOTDIR") throw error;
      const after = readFingerprintOrNull(filePath);
      if (attempt === 0 && after && !sameFingerprint(before, after)) continue;
      return { filePath, fingerprint: before, info: null, valid: false };
    }
  }
  return { filePath, fingerprint: current, info: null, valid: false };
}

export async function entryFromLiveSession(hint: SavedSessionHint): Promise<PersistedIndexRecord> {
  const info = await buildSessionInfoFromManager(hint.path, hint.source, hint.source.getEntries() as SessionEntry[], {
    resolveProjectInfo: false,
  });
  return {
    filePath: hint.path,
    fingerprint: hint.fingerprint,
    info,
    parentPath: hint.source.getHeader()?.parentSession,
    valid: Boolean(info),
  };
}

export async function planReconcile(
  root: string,
  files: readonly string[],
  known: SessionIndexState,
  read: (filePath: string, current: Fingerprint) => Promise<PersistedIndexRecord>,
): Promise<ReconcilePlan> {
  const discovered = new Set(files);
  const plan: ReconcilePlan = {
    upserts: [],
    removals: [...known.paths()].filter((filePath) => isUnderRoot(filePath, root) && !discovered.has(filePath)),
    filesDiscovered: files.length,
    filesParsed: 0,
    filesReused: 0,
  };
  let reusedSinceYield = 0;
  let lastYieldAt = performance.now();
  for (const filePath of files) {
    const current = readFingerprintOrNull(filePath);
    if (!current) continue;
    const existing = known.entry(filePath);
    let parsed = false;
    if (existing && sameFingerprint(existing.fingerprint, current)) {
      plan.filesReused += 1;
      reusedSinceYield += 1;
    } else {
      plan.upserts.push(await read(filePath, current));
      plan.filesParsed += 1;
      parsed = true;
    }
    if (parsed || reusedSinceYield >= YIELD_REUSED_BATCH || performance.now() - lastYieldAt >= YIELD_BUDGET_MS) {
      await yieldToEventLoop();
      reusedSinceYield = 0;
      lastYieldAt = performance.now();
    }
  }
  return plan;
}
