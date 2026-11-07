import { readFileSync } from "node:fs";
import path from "node:path";
import { atomicWrite, desktopUserDataPath } from "./desktop-state-file";
import { SESSION_RELATIONS, type SessionRelation } from "../shared/session-orchestration";
import type { SessionInfo } from "../shared/types";
import type { AutomationStepRef } from "./agent-session/execution-profile";

export interface SessionOriginRecord {
  relation: SessionRelation;
  createdBySessionId?: string;
  sourceType?: string;
  automationStep?: AutomationStepRef;
  createdAt: string;
}

export type SetSessionOriginInput = Omit<SessionOriginRecord, "createdAt">;
export type SessionMutationOperation = "agent_command" | "rename" | "delete" | "session_prompt";

type SessionOriginStateFile = {
  version: 1;
  sessions: Record<string, SessionOriginRecord>;
};

const EMPTY_STATE: SessionOriginStateFile = { version: 1, sessions: {} };

function isRelation(value: unknown): value is SessionRelation {
  return typeof value === "string" && (SESSION_RELATIONS as readonly string[]).includes(value);
}

function normalizeAutomationStep(value: unknown): AutomationStepRef | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const step = value as Record<string, unknown>;
  if (
    typeof step.taskId !== "string" ||
    !step.taskId.trim() ||
    typeof step.runId !== "string" ||
    !step.runId.trim() ||
    typeof step.stepId !== "string" ||
    !step.stepId.trim() ||
    !Number.isSafeInteger(step.attemptNo) ||
    (step.attemptNo as number) < 1
  )
    return undefined;
  return {
    taskId: step.taskId.trim(),
    runId: step.runId.trim(),
    stepId: step.stepId.trim(),
    attemptNo: step.attemptNo as number,
  };
}

function normalizeRecord(value: unknown): SessionOriginRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Partial<SessionOriginRecord>;
  if (!isRelation(record.relation)) return undefined;
  const createdBySessionId = typeof record.createdBySessionId === "string" ? record.createdBySessionId.trim() : "";
  if (record.relation === "delegate" && !createdBySessionId) return undefined;
  const sourceType = typeof record.sourceType === "string" ? record.sourceType.trim() : "";
  const automationStep = normalizeAutomationStep(record.automationStep);
  return {
    relation: record.relation,
    ...(createdBySessionId ? { createdBySessionId } : {}),
    ...(sourceType ? { sourceType } : {}),
    ...(automationStep ? { automationStep } : {}),
    createdAt: typeof record.createdAt === "string" && record.createdAt ? record.createdAt : new Date(0).toISOString(),
  };
}

function normalizeState(value: unknown): SessionOriginStateFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return structuredClone(EMPTY_STATE);
  const candidate = value as Partial<SessionOriginStateFile>;
  if (
    candidate.version !== 1 ||
    !candidate.sessions ||
    typeof candidate.sessions !== "object" ||
    Array.isArray(candidate.sessions)
  ) {
    return structuredClone(EMPTY_STATE);
  }
  const sessions: Record<string, SessionOriginRecord> = Object.create(null);
  for (const [rawSessionId, rawRecord] of Object.entries(candidate.sessions)) {
    const sessionId = rawSessionId.trim();
    const record = normalizeRecord(rawRecord);
    if (!sessionId || !record) continue;
    sessions[sessionId] = record;
  }
  return { version: 1, sessions };
}

export class SessionOriginStore {
  private state: SessionOriginStateFile | undefined;

  constructor(private readonly filePath: string) {}

  get(sessionId: string): SessionOriginRecord | undefined {
    const normalizedId = sessionId.trim();
    if (!normalizedId) return undefined;
    const sessions = this.load().sessions;
    return Object.hasOwn(sessions, normalizedId) ? structuredClone(sessions[normalizedId]) : undefined;
  }

  delete(sessionId: string): void {
    const normalizedId = sessionId.trim();
    if (!normalizedId) return;
    const state = this.load();
    if (!Object.hasOwn(state.sessions, normalizedId)) return;
    const sessions = { ...state.sessions };
    delete sessions[normalizedId];
    const next = { ...state, sessions };
    atomicWrite(this.filePath, next);
    this.state = next;
  }

  set(sessionId: string, record: SessionOriginRecord): void {
    const normalizedId = sessionId.trim();
    const normalizedRecord = normalizeRecord(record);
    if (!normalizedId || !normalizedRecord) throw new Error("Invalid session origin record");
    const state = this.load();
    const next = { ...state, sessions: { ...state.sessions, [normalizedId]: normalizedRecord } };
    atomicWrite(this.filePath, next);
    this.state = next;
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

let defaultStore: SessionOriginStore | undefined;

function getDefaultStore(): SessionOriginStore {
  defaultStore ??= new SessionOriginStore(path.join(desktopUserDataPath(), "session-origins.json"));
  return defaultStore;
}

export function getSessionOrigin(sessionId: string): SessionOriginRecord | undefined {
  return getDefaultStore().get(sessionId);
}

export function deleteSessionOrigin(sessionId: string): void {
  getDefaultStore().delete(sessionId);
}

export function setSessionOrigin(sessionId: string, record: SetSessionOriginInput): void {
  getDefaultStore().set(sessionId, { ...record, createdAt: new Date().toISOString() });
}

export const sessionOriginStore = {
  get: getSessionOrigin,
  set(sessionId: string, record: SessionOriginRecord): void {
    getDefaultStore().set(sessionId, record);
  },
  setOrigin: setSessionOrigin,
  delete: deleteSessionOrigin,
};

const READ_ONLY_AGENT_COMMANDS = new Set([
  "get_state",
  "get_tools",
  "get_commands",
  "get_session_stats",
  "get_last_assistant_text",
]);

export function isReadOnlyAgentCommand(commandType: unknown): boolean {
  return typeof commandType === "string" && READ_ONLY_AGENT_COMMANDS.has(commandType);
}

export const SessionAccess = {
  authorizeMutation(
    originStore: Pick<SessionOriginStore, "get">,
    sessionId: string,
    operation: SessionMutationOperation,
    opts?: { activeAutomationSessionIds?: ReadonlySet<string> },
  ): void {
    if (originStore.get(sessionId)?.relation !== "automation") return;
    if (operation === "delete") {
      if (opts?.activeAutomationSessionIds?.has(sessionId)) {
        throw new Error("Automation session is active and cannot be deleted");
      }
      return;
    }
    throw new Error("Automation session is sealed and cannot be modified");
  },
};

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
