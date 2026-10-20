export const SESSION_RELATIONS = ["fork", "delegate"] as const;
export type SessionRelation = (typeof SESSION_RELATIONS)[number];

export const SESSION_LIVE_STATUSES = ["awaiting_input", "error", "running"] as const;
export type SessionLiveStatus = (typeof SESSION_LIVE_STATUSES)[number];

export const SESSION_ACTIVITY_URGENCY = ["awaiting_input", "error", "running", "unread", "idle"] as const;
export type SessionActivityStatus = (typeof SESSION_ACTIVITY_URGENCY)[number];

export const SESSION_TOOL_NAMES = [
  "session_new",
  "session_prompt",
  "session_wait",
  "session_list",
  "session_read",
  "session_stop",
  "session_close",
] as const;
export type SessionToolName = (typeof SESSION_TOOL_NAMES)[number];

const SESSION_TOOL_NAME_SET = new Set<string>(SESSION_TOOL_NAMES);

export function isSessionToolName(name: string): boolean {
  return SESSION_TOOL_NAME_SET.has(name);
}

export const SESSION_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type SessionThinkingLevel = (typeof SESSION_THINKING_LEVELS)[number];

export const SESSION_ORCHESTRATION_LIMITS = {
  maxRunningMin: 1,
  maxRunningMax: 32,
  maxRunningDefault: 8,
  waitDefaultMs: 10 * 60_000,
  waitMaxMs: 30 * 60_000,
  readDefaultChars: 8_000,
  readMaxChars: 32_000,
  readToolCallsDefault: 10,
  readToolCallsMax: 50,
  listDefault: 30,
  listMax: 100,
  messageMaxChars: 100_000,
  nameMaxChars: 120,
} as const;

export interface SessionModelRef {
  provider: string;
  modelId: string;
}

export interface SessionOrchestrationSettings {
  enabled: boolean;
  maxRunning: number;
  model: SessionModelRef | null;
  thinkingLevel: SessionThinkingLevel | null;
  allowUserSessions: boolean;
}

export const DEFAULT_SESSION_ORCHESTRATION_SETTINGS: Readonly<SessionOrchestrationSettings> = Object.freeze({
  enabled: false,
  maxRunning: SESSION_ORCHESTRATION_LIMITS.maxRunningDefault,
  model: null,
  thinkingLevel: null,
  allowUserSessions: true,
});

function isModelRef(value: unknown): value is SessionModelRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.provider === "string" &&
    record.provider.trim().length > 0 &&
    record.provider.length <= 256 &&
    typeof record.modelId === "string" &&
    record.modelId.trim().length > 0 &&
    record.modelId.length <= 256
  );
}

export function isSessionThinkingLevel(value: unknown): value is SessionThinkingLevel {
  return typeof value === "string" && (SESSION_THINKING_LEVELS as readonly string[]).includes(value);
}

export function isSessionOrchestrationSettings(value: unknown): value is SessionOrchestrationSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.enabled === "boolean" &&
    Number.isInteger(record.maxRunning) &&
    (record.maxRunning as number) >= SESSION_ORCHESTRATION_LIMITS.maxRunningMin &&
    (record.maxRunning as number) <= SESSION_ORCHESTRATION_LIMITS.maxRunningMax &&
    (record.model === null || isModelRef(record.model)) &&
    (record.thinkingLevel === null || isSessionThinkingLevel(record.thinkingLevel)) &&
    typeof record.allowUserSessions === "boolean"
  );
}

export function normalizeSessionOrchestrationSettings(value: unknown): SessionOrchestrationSettings {
  const fallback = { ...DEFAULT_SESSION_ORCHESTRATION_SETTINGS };
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const record = value as Record<string, unknown>;
  const maxRunning = record.maxRunning;
  return {
    enabled: record.enabled === true,
    maxRunning:
      Number.isInteger(maxRunning) &&
      (maxRunning as number) >= SESSION_ORCHESTRATION_LIMITS.maxRunningMin &&
      (maxRunning as number) <= SESSION_ORCHESTRATION_LIMITS.maxRunningMax
        ? (maxRunning as number)
        : fallback.maxRunning,
    model: isModelRef(record.model) ? { provider: record.model.provider, modelId: record.model.modelId } : null,
    thinkingLevel: isSessionThinkingLevel(record.thinkingLevel) ? record.thinkingLevel : null,
    allowUserSessions: record.allowUserSessions !== false,
  };
}

export interface SessionSourceRef {
  sessionId: string;
  title?: string;
}

export interface SessionToolTargetDetails {
  targetSessionId: string;
  targetTitle?: string;
}

export function readSessionToolTarget(details: unknown): SessionToolTargetDetails | null {
  if (!details || typeof details !== "object" || Array.isArray(details)) return null;
  const record = details as Record<string, unknown>;
  if (typeof record.targetSessionId !== "string" || !record.targetSessionId) return null;
  return {
    targetSessionId: record.targetSessionId,
    ...(typeof record.targetTitle === "string" && record.targetTitle ? { targetTitle: record.targetTitle } : {}),
  };
}
