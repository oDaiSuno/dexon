export interface HeartbeatTickInput {
  now: number;
  lastTickAt: number;
  lastAcknowledgedAt: number;
  intervalMs: number;
  timeoutMs: number;
}

export interface HeartbeatTickResult {
  timedOut: boolean;
  clockDiscontinuity: boolean;
}

export function evaluateHeartbeatTick(input: HeartbeatTickInput): HeartbeatTickResult {
  const failureThresholdMs = input.intervalMs + input.timeoutMs;
  const tickGapMs = input.now - input.lastTickAt;
  const acknowledgementGapMs = input.now - input.lastAcknowledgedAt;
  const clockDiscontinuity = tickGapMs < 0 || acknowledgementGapMs < 0 || tickGapMs > failureThresholdMs;
  return {
    timedOut: !clockDiscontinuity && acknowledgementGapMs >= failureThresholdMs,
    clockDiscontinuity,
  };
}
