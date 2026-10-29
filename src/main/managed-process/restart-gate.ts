import type { ManagedProcessReaperStatus } from "./reaper.ts";

export function canRestartHostAfterCleanup(status: ManagedProcessReaperStatus): boolean {
  return status.records === 0 && (status.ready || status.errorCode === "CONTAINMENT_UNAVAILABLE");
}
