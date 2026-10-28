import { readFileSync } from "node:fs";
import path from "node:path";
import { atomicWrite, desktopUserDataPath } from "./desktop-state-file";

export interface SessionProjectRecord {
  projectRoot: string;
  worktreeBranch?: string;
}

type SessionProjectStateFile = {
  version: 1;
  sessions: Record<string, SessionProjectRecord>;
};

const EMPTY_STATE: SessionProjectStateFile = { version: 1, sessions: {} };

function normalizeRecord(value: unknown): SessionProjectRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Partial<SessionProjectRecord>;
  const projectRoot = typeof record.projectRoot === "string" ? record.projectRoot.trim() : "";
  if (!projectRoot) return undefined;
  const worktreeBranch = typeof record.worktreeBranch === "string" ? record.worktreeBranch.trim() : "";
  return { projectRoot, ...(worktreeBranch ? { worktreeBranch } : {}) };
}

function normalizeState(value: unknown): SessionProjectStateFile {
  if (!value || typeof value !== "object") return structuredClone(EMPTY_STATE);
  const candidate = value as Partial<SessionProjectStateFile>;
  if (candidate.version !== 1 || !candidate.sessions || typeof candidate.sessions !== "object") {
    return structuredClone(EMPTY_STATE);
  }
  const sessions: Record<string, SessionProjectRecord> = {};
  for (const [rawSessionId, rawRecord] of Object.entries(candidate.sessions)) {
    const sessionId = rawSessionId.trim();
    const record = normalizeRecord(rawRecord);
    if (!sessionId || !record) continue;
    sessions[sessionId] = record;
  }
  return { version: 1, sessions };
}

export class SessionProjectStore {
  private state: SessionProjectStateFile | undefined;
  private dirty = false;

  constructor(private readonly filePath: string) {}

  get(sessionId: string): SessionProjectRecord | undefined {
    const normalizedId = sessionId.trim();
    if (!normalizedId) return undefined;
    const record = this.load().sessions[normalizedId];
    return record ? { ...record } : undefined;
  }

  remember(sessionId: string, record: SessionProjectRecord): void {
    const normalizedId = sessionId.trim();
    const normalizedRecord = normalizeRecord(record);
    if (!normalizedId || !normalizedRecord) return;
    const state = this.load();
    const existing = state.sessions[normalizedId];
    const changed =
      !existing ||
      existing.projectRoot !== normalizedRecord.projectRoot ||
      existing.worktreeBranch !== normalizedRecord.worktreeBranch;
    state.sessions[normalizedId] = normalizedRecord;
    if (changed) this.dirty = true;
  }

  flush(): void {
    if (!this.dirty) return;
    atomicWrite(this.filePath, this.load());
    this.dirty = false;
  }

  private load(): SessionProjectStateFile {
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

let defaultStore: SessionProjectStore | undefined;

function getDefaultStore(): SessionProjectStore {
  defaultStore ??= new SessionProjectStore(path.join(desktopUserDataPath(), "session-projects.json"));
  return defaultStore;
}

export function getSessionProject(sessionId: string): SessionProjectRecord | undefined {
  return getDefaultStore().get(sessionId);
}

export function rememberSessionProject(sessionId: string, record: SessionProjectRecord): void {
  getDefaultStore().remember(sessionId, record);
}

export function flushSessionProjects(): void {
  try {
    getDefaultStore().flush();
  } catch (error) {
    console.error("[agent-host] failed to save session projects:", error);
  }
}
