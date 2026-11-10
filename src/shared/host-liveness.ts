import { evaluateHeartbeatTick } from "./heartbeat-liveness.ts";

export interface HostLivenessPolicy {
  readonly intervalMs: number;
  readonly timeoutMs: number;
  readonly graceWithWorkMs: number;
}

export const PRIMARY_HOST_LIVENESS: HostLivenessPolicy = {
  intervalMs: 15_000,
  timeoutMs: 10_000,
  graceWithWorkMs: 120_000,
};

export interface HostLivenessInput {
  readonly now: number;
  readonly lastTickAt: number;
  readonly lastPongAt: number;
  readonly atStake: number;
}

export type HostLivenessVerdict =
  | { readonly kind: "responsive" }
  | { readonly kind: "clock-jump" }
  | { readonly kind: "stalled"; readonly silentMs: number; readonly killAt: number }
  | { readonly kind: "hung"; readonly silentMs: number };

export function assessHostLiveness(
  input: HostLivenessInput,
  policy: HostLivenessPolicy = PRIMARY_HOST_LIVENESS,
): HostLivenessVerdict {
  const heartbeat = evaluateHeartbeatTick({
    now: input.now,
    lastTickAt: input.lastTickAt,
    lastAcknowledgedAt: input.lastPongAt,
    intervalMs: policy.intervalMs,
    timeoutMs: policy.timeoutMs,
  });
  if (heartbeat.clockDiscontinuity) return { kind: "clock-jump" };
  if (!heartbeat.timedOut) return { kind: "responsive" };
  const silentMs = input.now - input.lastPongAt;
  const killAt = input.lastPongAt + policy.intervalMs + policy.timeoutMs + policy.graceWithWorkMs;
  return input.atStake > 0 && input.now < killAt ? { kind: "stalled", silentMs, killAt } : { kind: "hung", silentMs };
}
