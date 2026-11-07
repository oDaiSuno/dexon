export const REMOTE_NODE_REQUIREMENT = { range: ">=22.19.0 <23", minimum: "22.19.0", major: 22 } as const;
export type NodeRequirement = typeof REMOTE_NODE_REQUIREMENT;
export type ConnectionStage =
  "authenticating" | "checking-runtime" | "deploying" | "starting-daemon" | "verifying" | "opening" | "synchronizing";
export type ProvisioningStep = 1 | 2 | 3 | 4;
export function provisioningStepOf(stage: ConnectionStage): ProvisioningStep {
  return stage === "authenticating" ? 1 : stage === "checking-runtime" ? 2 : stage === "deploying" ? 3 : 4;
}
export type ConnectionTransientReason =
  "network" | "timeout" | "transport" | "endpoint-unavailable" | "remote-unavailable" | "silent-socket";
export interface TransientFailure {
  reason: ConnectionTransientReason;
  detail: string;
}
export type BlockedDiagnosis =
  | { reason: "authentication"; detail: string; copyIdCommand: string | null }
  | { reason: "missing-node"; detail: string; required: NodeRequirement; upgradeCommand: string }
  | {
      reason: "unsupported-node-version";
      detail: string;
      detectedVersion: string;
      required: NodeRequirement;
      upgradeCommand: string;
    }
  | {
      reason: "host-key-changed";
      detail: string;
      knownHost: string;
      fingerprint: string | null;
      knownHostsFile?: string;
      mismatchLayer: "ssh-known-hosts";
    }
  | {
      reason: "identity-mismatch";
      detail: string;
      expectedEnvironmentId: string;
      actualEnvironmentId: string;
      mismatchLayer: "dexon-environment-id";
    }
  | { reason: "permission"; detail: string; path: string; suggestedStateDir: string }
  | { reason: "ssh-unavailable"; detail: string }
  | { reason: "outdated-daemon"; detail: string; remoteProtocolVersion: number }
  | { reason: "configuration" | "unsupported" | "unsupported-protocol"; detail: string };
export type ConnectionBlockedReason = BlockedDiagnosis["reason"];
export type ConnectionFailure =
  { kind: "blocked"; diagnosis: BlockedDiagnosis } | { kind: "transient"; failure: TransientFailure };
export type EnvironmentStatus =
  | { phase: "available" }
  | { phase: "offline"; lastFailure: TransientFailure | null }
  | { phase: "connecting"; stage: ConnectionStage; attempt: number; progress: number | null }
  | { phase: "connected"; generation: number; since: number }
  | { phase: "backoff"; reason: ConnectionTransientReason; detail: string; retryAt: number; failureCount: number }
  | { phase: "blocked"; diagnosis: BlockedDiagnosis };
export type SupervisorConnectionPhase = EnvironmentStatus["phase"];
