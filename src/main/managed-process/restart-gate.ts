import type { ManagedProcessReaperStatus } from "./reaper.ts";

export function canRestartHostAfterCleanup(status: ManagedProcessReaperStatus): boolean {
  return status.ready && status.records === 0;
}
