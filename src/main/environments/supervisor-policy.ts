import { DEFAULT_LIFECYCLE_POLICY, type LifecyclePolicy } from "../../contract/environment-commands.ts";
import { REMOTE_NODE_REQUIREMENT, type BlockedDiagnosis } from "../../contract/environment-status.ts";
import type {
  ConnectionStage,
  ConnectionBlockedReason,
  ConnectionTransientReason,
  EnvironmentStatus,
} from "../../contract/environment.ts";

export const RETRY_BASE_DELAY_MS = 1_000;
export const RETRY_MAX_DELAY_MS = 300_000;
export const BACKOFF_RESET_AFTER_MS = 30_000;
export const SILENT_SOCKET_CHECK_AFTER_MS = 500;
export const SILENT_SOCKET_RECHECK_EVERY_MS = 1_000;
export const REMOTE_SILENT_SOCKET_AFTER_MS = 2_500;
export const QUICK_PROBE_TIMEOUT_MS = 3_000;
export const REMOTE_PROBE_TIMEOUT_MS = 15_000;

export type ConnectError =
  | { kind: "transient"; reason: ConnectionTransientReason; message: string }
  | { kind: "blocked"; reason: ConnectionBlockedReason; message: string };

export class EnvironmentConnectionError extends Error {
  readonly kind: ConnectError["kind"];
  readonly reason: ConnectionTransientReason | ConnectionBlockedReason;
  readonly diagnosis: BlockedDiagnosis | null;

  constructor(
    kind: ConnectError["kind"],
    reason: ConnectionTransientReason | ConnectionBlockedReason,
    message: string,
    diagnosis?: BlockedDiagnosis,
  ) {
    super(message);
    this.name = "EnvironmentConnectionError";
    this.kind = kind;
    this.reason = reason;
    this.diagnosis =
      kind === "blocked" ? (diagnosis ?? diagnosisForReason(reason as ConnectionBlockedReason, message)) : null;
  }
}

export interface SupervisorState {
  status: EnvironmentStatus;
  failureCount: number;
  generation: number;
  connectedSince: number | null;
  probeUnanswered: boolean;
}

export type SupervisorEvent =
  | { type: "policy-changed" }
  | { type: "start" }
  | { type: "stage"; stage: ConnectionStage; progress?: number | null }
  | { type: "connected"; now: number }
  | { type: "failure"; error: unknown; now: number; random?: number }
  | { type: "silent-socket" }
  | { type: "disconnect" }
  | { type: "probe"; unanswered: boolean }
  | { type: "tick"; now: number };

export function initialSupervisorState(): SupervisorState {
  return {
    status: { phase: "offline", lastFailure: null },
    failureCount: 0,
    generation: 0,
    connectedSince: null,
    probeUnanswered: false,
  };
}

export function computeRetryDelayMs(failureCount: number, random = Math.random()): number {
  const failures = Number.isFinite(failureCount) ? Math.max(0, Math.floor(failureCount)) : 30;
  const ceiling = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** (failures + 1));
  const r = Number.isFinite(random) ? Math.min(1, Math.max(0, random)) : 0.5;
  return Math.round(ceiling / 2 + (ceiling / 2) * r);
}

export function shouldResetFailureLadder(
  connectedSince: number | null,
  now: number,
  probeUnanswered: boolean,
): boolean {
  return connectedSince !== null && !probeUnanswered && now - connectedSince >= BACKOFF_RESET_AFTER_MS;
}

export function classifyConnectError(error: unknown): ConnectError {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof EnvironmentConnectionError) {
    return error.kind === "blocked"
      ? { kind: "blocked", reason: error.reason as ConnectionBlockedReason, message }
      : { kind: "transient", reason: error.reason as ConnectionTransientReason, message };
  }
  if (/identity.mismatch|environment.*does not match/iu.test(message))
    return { kind: "blocked", reason: "identity-mismatch", message };
  if (/unsupported.protocol|protocol.*mismatch/iu.test(message))
    return { kind: "blocked", reason: "unsupported-protocol", message };
  if (/node.*(?:not found|not installed)|missing.node/iu.test(message))
    return { kind: "blocked", reason: "missing-node", message };
  if (/permission denied.*(?:publickey|password)|authentication|unauthori[sz]ed|\b401\b/iu.test(message))
    return { kind: "blocked", reason: "authentication", message };
  if (/EACCES|EROFS|read.only file system|permission denied|forbidden|\b403\b/iu.test(message))
    return { kind: "blocked", reason: "permission", message };
  if (/invalid|configuration|bad owner or permissions|plaintext/iu.test(message))
    return { kind: "blocked", reason: "configuration", message };
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED|host key verification failed/iu.test(message))
    return { kind: "blocked", reason: "host-key-changed", message };
  if (/unsupported/iu.test(message)) return { kind: "blocked", reason: "unsupported", message };
  if (/timeout|timed out|aborted/iu.test(message)) return { kind: "transient", reason: "timeout", message };
  if (/ECONNREFUSED|endpoint.*unavailable|\b50[234]\b/iu.test(message))
    return { kind: "transient", reason: "endpoint-unavailable", message };
  if (/network|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|could not resolve hostname|connection reset/iu.test(message))
    return { kind: "transient", reason: "network", message };
  return { kind: "transient", reason: "transport", message };
}

export function reduceSupervisor(
  state: SupervisorState,
  event: SupervisorEvent,
  policy: LifecyclePolicy = DEFAULT_LIFECYCLE_POLICY,
): SupervisorState {
  switch (event.type) {
    case "policy-changed":
      return !policy.autoReconnect && state.status.phase === "backoff"
        ? {
            ...state,
            status: { phase: "offline", lastFailure: { reason: state.status.reason, detail: state.status.detail } },
          }
        : state;
    case "start":
      return {
        ...state,
        status: { phase: "connecting", stage: "authenticating", attempt: state.failureCount + 1, progress: null },
        connectedSince: null,
        probeUnanswered: false,
      };
    case "stage":
      return {
        ...state,
        status: {
          phase: "connecting",
          stage: event.stage,
          attempt: state.failureCount + 1,
          progress: event.progress ?? null,
        },
      };
    case "connected": {
      const generation = state.generation + 1;
      return {
        ...state,
        generation,
        connectedSince: event.now,
        probeUnanswered: false,
        status: { phase: "connected", generation, since: event.now },
      };
    }
    case "failure": {
      const error = classifyConnectError(event.error);
      const previous = shouldResetFailureLadder(state.connectedSince, event.now, state.probeUnanswered)
        ? 0
        : state.failureCount;
      return {
        ...state,
        connectedSince: null,
        probeUnanswered: false,
        failureCount: error.kind === "transient" ? previous + 1 : previous,
        status:
          error.kind === "blocked"
            ? {
                phase: "blocked",
                diagnosis:
                  event.error instanceof EnvironmentConnectionError && event.error.diagnosis
                    ? event.error.diagnosis
                    : diagnosisForReason(error.reason, error.message),
              }
            : !policy.autoReconnect
              ? { phase: "offline", lastFailure: { reason: error.reason, detail: error.message } }
              : {
                  phase: "backoff",
                  reason: error.reason,
                  detail: error.message,
                  retryAt: event.now + computeRetryDelayMs(previous, event.random),
                  failureCount: previous + 1,
                },
      };
    }
    case "silent-socket":
      return {
        ...state,
        failureCount: 0,
        connectedSince: null,
        probeUnanswered: false,
        status: { phase: "connecting", stage: "authenticating", attempt: 1, progress: null },
      };
    case "disconnect":
      return { ...initialSupervisorState(), generation: state.generation };
    case "probe":
      return { ...state, probeUnanswered: event.unanswered };
    case "tick":
      return state.failureCount > 0 && shouldResetFailureLadder(state.connectedSince, event.now, state.probeUnanswered)
        ? { ...state, failureCount: 0 }
        : state;
  }
}

export function diagnosisForReason(reason: ConnectionBlockedReason, detail: string): BlockedDiagnosis {
  switch (reason) {
    case "authentication":
      return { reason, detail, copyIdCommand: null };
    case "missing-node":
      return {
        reason,
        detail,
        required: REMOTE_NODE_REQUIREMENT,
        upgradeCommand: "nvm install 22 && nvm alias default 22",
      };
    case "unsupported-node-version":
      return {
        reason,
        detail,
        detectedVersion: "unknown",
        required: REMOTE_NODE_REQUIREMENT,
        upgradeCommand: "nvm install 22 && nvm alias default 22",
      };
    case "host-key-changed":
      return { reason, detail, knownHost: "", fingerprint: null, mismatchLayer: "ssh-known-hosts" };
    case "identity-mismatch":
      return {
        reason,
        detail,
        expectedEnvironmentId: "",
        actualEnvironmentId: "",
        mismatchLayer: "dexon-environment-id",
      };
    case "permission":
      return { reason, detail, path: "~/.dexon", suggestedStateDir: "/tmp/dexon" };
    case "outdated-daemon":
      return { reason, detail, remoteProtocolVersion: 0 };
    default:
      return { reason, detail };
  }
}
