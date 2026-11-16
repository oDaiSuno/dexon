import { readFileSync } from "node:fs";
import path from "node:path";
import { atomicWriteAsync, desktopUserDataPath } from "./desktop-state-file";

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
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: Promise<void> | undefined;

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
    if (changed) this.scheduleFlush();
  }

  private scheduleFlush(): void {
    this.dirty = true;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flush().catch((error) => {
        console.error("[agent-host] failed to save session projects:", error);
        const code = (error as NodeJS.ErrnoException).code;
        if (this.dirty && this.timer === undefined && (code === "EBUSY" || code === "EACCES")) this.scheduleFlush();
      });
    }, 500);
    this.timer.unref?.();
  }

  async flush(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.pending) return this.pending;
    if (!this.dirty) return;
    this.pending = this.writePending();
    return this.pending;
  }

  private async writePending(): Promise<void> {
    try {
      while (this.dirty) {
        this.dirty = false;
        await atomicWriteAsync(this.filePath, this.load());
      }
    } catch (error) {
      this.dirty = true;
      throw error;
    } finally {
      clearTimeout(this.timer);
      this.timer = undefined;
      this.pending = undefined;
    }
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

const defaultStores = new Map<string, SessionProjectStore>();

function getDefaultStore(): SessionProjectStore {
  const filePath = path.resolve(desktopUserDataPath(), "session-projects.json");
  let store = defaultStores.get(filePath);
  if (!store) {
    store = new SessionProjectStore(filePath);
    defaultStores.set(filePath, store);
  }
  return store;
}

export function getSessionProject(sessionId: string): SessionProjectRecord | undefined {
  return getDefaultStore().get(sessionId);
}

export function rememberSessionProject(sessionId: string, record: SessionProjectRecord): void {
  getDefaultStore().remember(sessionId, record);
}

export async function flushSessionProjects(): Promise<void> {
  await Promise.all(
    [...defaultStores.values()].map(async (store) => {
      try {
        await store.flush();
      } catch (error) {
        console.error("[agent-host] failed to save session projects:", error);
      }
    }),
  );
}
