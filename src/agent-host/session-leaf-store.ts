import { readFileSync } from "node:fs";
import path from "node:path";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { atomicWrite, desktopUserDataPath } from "./desktop-state-file";

export interface SessionLeafChoice {
  leafId: string;
  lastEntryId: string;
}

type SessionLeafStateFile = {
  version: 1;
  sessions: Record<string, SessionLeafChoice>;
};

const EMPTY_STATE: SessionLeafStateFile = { version: 1, sessions: {} };

function normalizeRecord(value: unknown): SessionLeafChoice | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Partial<SessionLeafChoice>;
  const leafId = typeof record.leafId === "string" ? record.leafId.trim() : "";
  const lastEntryId = typeof record.lastEntryId === "string" ? record.lastEntryId.trim() : "";
  if (!leafId || !lastEntryId) return undefined;
  return { leafId, lastEntryId };
}

function normalizeState(value: unknown): SessionLeafStateFile {
  if (!value || typeof value !== "object") return structuredClone(EMPTY_STATE);
  const candidate = value as Partial<SessionLeafStateFile>;
  if (candidate.version !== 1 || !candidate.sessions || typeof candidate.sessions !== "object") {
    return structuredClone(EMPTY_STATE);
  }
  const sessions: Record<string, SessionLeafChoice> = {};
  for (const [rawSessionId, rawRecord] of Object.entries(candidate.sessions)) {
    const sessionId = rawSessionId.trim();
    const record = normalizeRecord(rawRecord);
    if (!sessionId || !record) continue;
    sessions[sessionId] = record;
  }
  return { version: 1, sessions };
}

export class SessionLeafStore {
  private state: SessionLeafStateFile | undefined;

  constructor(private readonly filePath: string) {}

  get(sessionId: string): SessionLeafChoice | undefined {
    const normalizedId = sessionId.trim();
    if (!normalizedId) return undefined;
    const record = this.load().sessions[normalizedId];
    return record ? { ...record } : undefined;
  }

  set(sessionId: string, record: SessionLeafChoice): void {
    const normalizedId = sessionId.trim();
    const normalizedRecord = normalizeRecord(record);
    if (!normalizedId || !normalizedRecord) throw new Error("Invalid session leaf choice");
    const state = this.load();
    const existing = state.sessions[normalizedId];
    if (
      existing &&
      existing.leafId === normalizedRecord.leafId &&
      existing.lastEntryId === normalizedRecord.lastEntryId
    ) {
      return;
    }
    state.sessions[normalizedId] = normalizedRecord;
    atomicWrite(this.filePath, state);
  }

  delete(sessionId: string): void {
    const normalizedId = sessionId.trim();
    if (!normalizedId) return;
    const state = this.load();
    if (!(normalizedId in state.sessions)) return;
    delete state.sessions[normalizedId];
    atomicWrite(this.filePath, state);
  }

  private load(): SessionLeafStateFile {
    if (this.state) return this.state;
    try {
      this.state = normalizeState(JSON.parse(readFileSync(this.filePath, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
      this.state = structuredClone(EMPTY_STATE);
    }
    return this.state;
  }
}

let defaultStore: SessionLeafStore | undefined;

function getDefaultStore(): SessionLeafStore {
  defaultStore ??= new SessionLeafStore(path.join(desktopUserDataPath(), "session-leaf-choices.json"));
  return defaultStore;
}

export function getSessionLeafChoice(sessionId: string): SessionLeafChoice | undefined {
  return getDefaultStore().get(sessionId);
}

export function deleteSessionLeafChoice(sessionId: string): void {
  getDefaultStore().delete(sessionId);
}

function lastEntryIdOf(manager: SessionManager): string | null {
  return manager.getEntries().at(-1)?.id ?? null;
}

export function rememberLeafChoice(sessionId: string, manager: SessionManager): void {
  if (!sessionId) return;
  const leafId = manager.getLeafId();
  const lastEntryId = lastEntryIdOf(manager);
  if (!leafId || !lastEntryId || leafId === lastEntryId) {
    deleteSessionLeafChoice(sessionId);
    return;
  }
  getDefaultStore().set(sessionId, { leafId, lastEntryId });
}

export function applyStoredLeafChoice(sessionId: string, manager: SessionManager): boolean {
  const record = getSessionLeafChoice(sessionId);
  if (!record) return false;
  const entries = manager.getEntries();
  if (lastEntryIdOf(manager) !== record.lastEntryId) return false;
  if (!entries.some((entry) => entry.id === record.leafId)) return false;
  manager.branch(record.leafId);
  return true;
}
