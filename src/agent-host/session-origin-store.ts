import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { SESSION_RELATIONS, type SessionRelation } from "../shared/session-orchestration";
import type { SessionInfo } from "../shared/types";

export interface SessionOriginRecord {
  relation: SessionRelation;
  createdBySessionId?: string;
  createdAt: string;
}

type SessionOriginStateFile = {
  version: 1;
  sessions: Record<string, SessionOriginRecord>;
};

const EMPTY_STATE: SessionOriginStateFile = { version: 1, sessions: {} };

function isRelation(value: unknown): value is SessionRelation {
  return typeof value === "string" && (SESSION_RELATIONS as readonly string[]).includes(value);
}

function normalizeRecord(value: unknown): SessionOriginRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Partial<SessionOriginRecord>;
  if (!isRelation(record.relation)) return undefined;
  const createdBySessionId = typeof record.createdBySessionId === "string" ? record.createdBySessionId.trim() : "";
  if (record.relation === "delegate" && !createdBySessionId) return undefined;
  return {
    relation: record.relation,
    ...(createdBySessionId ? { createdBySessionId } : {}),
    createdAt: typeof record.createdAt === "string" && record.createdAt ? record.createdAt : new Date(0).toISOString(),
  };
}

function normalizeState(value: unknown): SessionOriginStateFile {
  if (!value || typeof value !== "object") return structuredClone(EMPTY_STATE);
  const candidate = value as Partial<SessionOriginStateFile>;
  if (candidate.version !== 1 || !candidate.sessions || typeof candidate.sessions !== "object") {
    return structuredClone(EMPTY_STATE);
  }
  const sessions: Record<string, SessionOriginRecord> = {};
  for (const [rawSessionId, rawRecord] of Object.entries(candidate.sessions)) {
    const sessionId = rawSessionId.trim();
    const record = normalizeRecord(rawRecord);
    if (!sessionId || !record) continue;
    sessions[sessionId] = record;
  }
  return { version: 1, sessions };
}

function atomicWrite(filePath: string, value: SessionOriginStateFile): void {
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
  try {
    renameSync(temporaryPath, filePath);
    try {
      chmodSync(filePath, 0o600);
    } catch {
      /* best effort on platforms without POSIX modes */
    }
  } catch (error) {
    try {
      unlinkSync(temporaryPath);
    } catch {
      /* ignore cleanup failure */
    }
    throw error;
  }
}

export class SessionOriginStore {
  private state: SessionOriginStateFile | undefined;

  constructor(private readonly filePath: string) {}

  get(sessionId: string): SessionOriginRecord | undefined {
    const normalizedId = sessionId.trim();
    if (!normalizedId) return undefined;
    const record = this.load().sessions[normalizedId];
    return record ? { ...record } : undefined;
  }

  set(sessionId: string, record: SessionOriginRecord): void {
    const normalizedId = sessionId.trim();
    const normalizedRecord = normalizeRecord(record);
    if (!normalizedId || !normalizedRecord) throw new Error("Invalid session origin record");
    const state = this.load();
    state.sessions[normalizedId] = normalizedRecord;
    atomicWrite(this.filePath, state);
  }

  private load(): SessionOriginStateFile {
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

function desktopUserDataPath(): string {
  return (
    process.env.PI_DESKTOP_USER_DATA?.trim() ||
    (process.env.PI_CODING_AGENT_DIR ? path.join(process.env.PI_CODING_AGENT_DIR, "desktop") : "") ||
    path.join(homedir(), ".pi", "desktop")
  );
}

let defaultStore: SessionOriginStore | undefined;

function getDefaultStore(): SessionOriginStore {
  defaultStore ??= new SessionOriginStore(path.join(desktopUserDataPath(), "session-origins.json"));
  return defaultStore;
}

export function getSessionOrigin(sessionId: string): SessionOriginRecord | undefined {
  return getDefaultStore().get(sessionId);
}

export function setSessionOrigin(sessionId: string, record: Omit<SessionOriginRecord, "createdAt">): void {
  getDefaultStore().set(sessionId, { ...record, createdAt: new Date().toISOString() });
}

export function withSessionOrigin(info: SessionInfo): SessionInfo {
  const origin = getSessionOrigin(info.id);
  if (!origin) return info;
  if (origin.relation === "delegate" && origin.createdBySessionId) {
    return {
      ...info,
      relation: origin.relation,
      createdBySessionId: origin.createdBySessionId,
      parentSessionId: origin.createdBySessionId,
    };
  }
  return { ...info, relation: origin.relation };
}
