export class SessionOrchestrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionOrchestrationError";
  }
}

export const CROSS_PROJECT_REFUSAL =
  "Session tools can only create sessions inside the caller's own project; that directory belongs to another project";

export const CALLER_ONLY_REFUSAL = "Only sessions created by this session can be";

export const CYCLE_REFUSAL = "Waiting on that session would wait on this session itself (cycle)";

export const OWNER_DISABLED_REFUSAL =
  "Prompting sessions the user created is turned off in Session collaboration settings";

export const SELF_TARGET_REFUSAL = "A session cannot prompt itself";

export const CHANNEL_REFUSAL = "Session tools are unavailable for messaging-channel turns";

export const DISABLED_REFUSAL = "Enable Session collaboration in Settings first";

const WAIT_CANCELLED_MESSAGE = "Waiting for another session was stopped; that session keeps running";

export function runningLimitRefusal(maxRunning: number): string {
  return `At most ${maxRunning} sessions created by agents can run at once; wait for one to finish or close it`;
}

function abortError(): Error {
  const error = new Error(WAIT_CANCELLED_MESSAGE);
  error.name = "AbortError";
  return error;
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}
