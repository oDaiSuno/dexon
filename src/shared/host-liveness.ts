import { evaluateHeartbeatTick } from "./heartbeat-liveness.ts";
import { stakeOf, type HostActivitySnapshot } from "./host-protocol.ts";

export interface HostLivenessPolicy {
  readonly intervalMs: number;
  readonly unresponsiveMs: number;
  readonly idleKillMs: number;
  readonly busyKillMs: number;
  readonly sessionKillMs: number;
}

export const PRIMARY_HOST_LIVENESS: HostLivenessPolicy = {
  intervalMs: 5_000,
  unresponsiveMs: 10_000,
  idleKillMs: 25_000,
  busyKillMs: 45_000,
  sessionKillMs: 145_000,
};

export interface HostLivenessInput {
  readonly now: number;
  readonly lastTickAt: number;
  readonly lastPongAt: number;
  readonly activity: HostActivitySnapshot;
}

export type HostLivenessVerdict =
  | { readonly kind: "responsive" }
  | { readonly kind: "clock-jump" }
  | { readonly kind: "unresponsive"; readonly silentMs: number; readonly killAt: number }
  | { readonly kind: "hung"; readonly silentMs: number };

function killLimitMs(activity: HostActivitySnapshot, policy: HostLivenessPolicy): number {
  if (stakeOf(activity) > 0) return policy.sessionKillMs;
  return (activity.inFlightRequests ?? 0) > 0 ? policy.busyKillMs : policy.idleKillMs;
}

export function assessHostLiveness(
  input: HostLivenessInput,
  policy: HostLivenessPolicy = PRIMARY_HOST_LIVENESS,
): HostLivenessVerdict {
  const heartbeat = evaluateHeartbeatTick({
    now: input.now,
    lastTickAt: input.lastTickAt,
    lastAcknowledgedAt: input.lastPongAt,
    intervalMs: policy.intervalMs,
    timeoutMs: policy.unresponsiveMs - policy.intervalMs,
  });
  if (heartbeat.clockDiscontinuity) return { kind: "clock-jump" };
  if (!heartbeat.timedOut) return { kind: "responsive" };
  const silentMs = input.now - input.lastPongAt;
  const killAt = input.lastPongAt + killLimitMs(input.activity, policy);
  return input.now < killAt ? { kind: "unresponsive", silentMs, killAt } : { kind: "hung", silentMs };
}
