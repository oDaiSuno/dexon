import { readFileSync } from "node:fs";
import path from "node:path";
import type { ToolIntent, ToolIntentStore } from "./agent-session/tool-intent";
import { readToolIntent, toolIntentFromNames } from "./agent-session/tool-intent";
import { atomicWrite, desktopUserDataPath } from "./desktop-state-file";

type StoredSessionTools = {
  intent: ToolIntent;
  updatedAt: string;
};

type SessionToolStateFile = {
  version: 2;
  sessions: Record<string, StoredSessionTools>;
};

interface LegacySessionToolEntry {
  toolNames?: unknown;
  updatedAt?: unknown;
}

interface LegacySessionToolStateFile {
  version: 1;
  sessions: Record<string, LegacySessionToolEntry>;
}

const EMPTY_STATE = (): SessionToolStateFile => ({ version: 2, sessions: {} });

function readLegacyToolNames(value: unknown): ToolIntent | undefined {
  if (!Array.isArray(value) || !value.every((name) => typeof name === "string")) return undefined;
  return toolIntentFromNames(value as string[]);
}

function normalizeTimestamp(value: unknown): string {
  return typeof value === "string" && value ? value : new Date(0).toISOString();
}

function migrateEntry(rawEntry: unknown): StoredSessionTools | undefined {
  if (!rawEntry || typeof rawEntry !== "object") return undefined;
  const entry = rawEntry as { intent?: unknown; toolNames?: unknown; updatedAt?: unknown };
  const intent = readToolIntent(entry.intent) ?? readLegacyToolNames(entry.toolNames);
  if (!intent) return undefined;
  return { intent, updatedAt: normalizeTimestamp(entry.updatedAt) };
}

function normalizeSessions(rawSessions: unknown): Record<string, StoredSessionTools> {
  if (!rawSessions || typeof rawSessions !== "object") return {};
  const sessions: Record<string, StoredSessionTools> = {};
  for (const [rawSessionId, rawEntry] of Object.entries(rawSessions as Record<string, unknown>)) {
    const sessionId = rawSessionId.trim();
    if (!sessionId) continue;
    const entry = migrateEntry(rawEntry);
    if (!entry) continue;
    sessions[sessionId] = entry;
  }
  return sessions;
}

function normalizeState(value: unknown): SessionToolStateFile {
  if (!value || typeof value !== "object") return EMPTY_STATE();
  const candidate = value as Partial<SessionToolStateFile> & Partial<LegacySessionToolStateFile>;
  if (candidate.version !== 1 && candidate.version !== 2) return EMPTY_STATE();
  return { version: 2, sessions: normalizeSessions(candidate.sessions) };
}

export class DesktopSessionToolStore implements ToolIntentStore {
  private state: SessionToolStateFile | undefined;
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  get(sessionId: string): ToolIntent | undefined {
    const normalizedId = sessionId.trim();
    if (!normalizedId) return undefined;
    return this.load().sessions[normalizedId]?.intent;
  }

  set(sessionId: string, intent: ToolIntent): void {
    const normalizedId = sessionId.trim();
    const normalizedIntent = readToolIntent(intent);
    if (!normalizedId || !normalizedIntent) throw new Error("Invalid session tool state");
    const state = this.load();
    state.sessions[normalizedId] = { intent: normalizedIntent, updatedAt: new Date().toISOString() };
    atomicWrite(this.filePath, state);
  }

  private load(): SessionToolStateFile {
    if (this.state) return this.state;
    try {
      this.state = normalizeState(JSON.parse(readFileSync(this.filePath, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
      this.state = EMPTY_STATE();
    }
    return this.state;
  }
}

let defaultStore: DesktopSessionToolStore | undefined;

function getDefaultStore(): DesktopSessionToolStore {
  defaultStore ??= new DesktopSessionToolStore(path.join(desktopUserDataPath(), "session-tools.json"));
  return defaultStore;
}

export const desktopToolIntents: ToolIntentStore = {
  get: (sessionId) => getDefaultStore().get(sessionId),
  set: (sessionId, intent) => getDefaultStore().set(sessionId, intent),
};

export function getDesktopSessionToolIntent(sessionId: string): ToolIntent | undefined {
  return getDefaultStore().get(sessionId);
}
