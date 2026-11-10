import type { BrowserCapabilitySnapshot } from "../contract/browser";
import type { SessionOrchestrationSettings } from "./session-orchestration";
import type { ToolchainSnapshot } from "./toolchains/types";

export interface HostActivitySnapshot {
  readonly running: readonly string[];
  readonly starting: readonly string[];
}

export const EMPTY_ACTIVITY: HostActivitySnapshot = { running: [], starting: [] };

export function stakeOf(activity: HostActivitySnapshot): number {
  return new Set([...activity.running, ...activity.starting]).size;
}

export type MainToHost =
  | { readonly type: "ping"; readonly seq: number }
  | { readonly type: "attach-port" }
  | { readonly type: "shutdown" }
  | {
      readonly type: "managed-process-owner:init";
      readonly version: 1;
      readonly mainPid: number;
      readonly mainStartFingerprint: string;
      readonly mainImagePath: string;
      readonly hostInstanceId: string;
    }
  | { readonly type: "toolchain:init" | "toolchain:changed"; readonly snapshot: ToolchainSnapshot }
  | { readonly type: "browser:init" | "browser:changed"; readonly snapshot: BrowserCapabilitySnapshot }
  | { readonly type: "session-orchestration:settings"; readonly settings: SessionOrchestrationSettings }
  | {
      readonly type: "host-rpc-result";
      readonly id: string;
      readonly ok: boolean;
      readonly result?: unknown;
      readonly error?: unknown;
    };

export type HostToMain =
  | { readonly type: "ready"; readonly ts: number; readonly piVersion: string | null }
  | {
      readonly type: "pong";
      readonly seq: number;
      readonly ts: number;
      readonly lagMaxMs: number;
      readonly activity: HostActivitySnapshot;
    }
  | { readonly type: "activity"; readonly activity: HostActivitySnapshot }
  | { readonly type: "log"; readonly message: string }
  | { readonly type: "running-sessions"; readonly sessionIds: string[] }
  | { readonly type: "agent-end"; readonly sessionId: string; readonly eventType?: string }
  | { readonly type: "toolchain:ack"; readonly revision: number }
  | { readonly type: "browser:ack"; readonly revision: number }
  | { readonly type: "managed-process-owner:ack"; readonly version: 1; readonly hostInstanceId: string }
  | { readonly type: "managed-process-count"; readonly count: number }
  | { readonly type: "host-rpc"; readonly id: string; readonly method: string; readonly params: unknown };

type Parser<T> = (raw: Record<string, unknown>) => T | null;

function isNonnegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNonnegativeInteger(value: unknown): value is number {
  return isNonnegativeNumber(value) && Number.isSafeInteger(value);
}

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function parseActivity(value: unknown): HostActivitySnapshot | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  return isStrings(raw.running) && isStrings(raw.starting)
    ? { running: [...raw.running], starting: [...raw.starting] }
    : null;
}

const HOST_TO_MAIN_PARSERS = {
  ready: (raw) =>
    isNonnegativeNumber(raw.ts) &&
    (raw.piVersion === undefined || raw.piVersion === null || typeof raw.piVersion === "string")
      ? { type: "ready", ts: raw.ts, piVersion: raw.piVersion ?? null }
      : null,
  pong: (raw) => {
    if (
      raw.seq === undefined &&
      raw.lagMaxMs === undefined &&
      raw.activity === undefined &&
      isNonnegativeNumber(raw.ts)
    ) {
      return { type: "pong", seq: 0, ts: raw.ts, lagMaxMs: 0, activity: EMPTY_ACTIVITY };
    }
    const activity = parseActivity(raw.activity);
    return isNonnegativeInteger(raw.seq) && isNonnegativeNumber(raw.ts) && isNonnegativeNumber(raw.lagMaxMs) && activity
      ? { type: "pong", seq: raw.seq, ts: raw.ts, lagMaxMs: raw.lagMaxMs, activity }
      : null;
  },
  activity: (raw) => {
    const activity = parseActivity(raw.activity);
    return activity ? { type: "activity", activity } : null;
  },
  log: (raw) => (typeof raw.message === "string" ? { type: "log", message: raw.message } : null),
  "running-sessions": (raw) =>
    isStrings(raw.sessionIds) ? { type: "running-sessions", sessionIds: [...raw.sessionIds] } : null,
  "agent-end": (raw) =>
    typeof raw.sessionId === "string" && (raw.eventType === undefined || typeof raw.eventType === "string")
      ? {
          type: "agent-end",
          sessionId: raw.sessionId,
          ...(raw.eventType === undefined ? {} : { eventType: raw.eventType }),
        }
      : null,
  "toolchain:ack": (raw) =>
    isNonnegativeInteger(raw.revision) ? { type: "toolchain:ack", revision: raw.revision } : null,
  "browser:ack": (raw) => (isNonnegativeInteger(raw.revision) ? { type: "browser:ack", revision: raw.revision } : null),
  "managed-process-owner:ack": (raw) =>
    raw.version === 1 && typeof raw.hostInstanceId === "string"
      ? { type: "managed-process-owner:ack", version: 1, hostInstanceId: raw.hostInstanceId }
      : null,
  "managed-process-count": (raw) =>
    isNonnegativeInteger(raw.count) ? { type: "managed-process-count", count: raw.count } : null,
  "host-rpc": (raw) =>
    typeof raw.id === "string" && raw.id.length > 0 && typeof raw.method === "string" && raw.method.length > 0
      ? { type: "host-rpc", id: raw.id, method: raw.method, params: raw.params }
      : null,
} satisfies { [K in HostToMain["type"]]: Parser<Extract<HostToMain, { type: K }>> };

export function parseHostToMain(raw: unknown): HostToMain | null {
  if (!raw || typeof raw !== "object") return null;
  const message = raw as Record<string, unknown>;
  if (typeof message.type !== "string" || !Object.hasOwn(HOST_TO_MAIN_PARSERS, message.type)) return null;
  return HOST_TO_MAIN_PARSERS[message.type as HostToMain["type"]](message);
}
