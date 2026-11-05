import { readFileSync } from "node:fs";

const currentProcessCreationTimestampMs = Math.floor(Date.now() - process.uptime() * 1000);

type ProcessWithCreationTime = NodeJS.Process & { getCreationTime?: () => number | null };

function hasRuntimeCreationTimeApi(): boolean {
  return typeof (process as ProcessWithCreationTime).getCreationTime === "function";
}

function readRuntimeCreationTimestampMs(): number | null {
  try {
    const value = (process as ProcessWithCreationTime).getCreationTime?.();
    if (typeof value !== "number" || !Number.isSafeInteger(Math.floor(value)) || value <= 0) return null;
    return Math.floor(value);
  } catch {
    return null;
  }
}

function readLinuxCreationTimestampMs(pid: number): number | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const commandEnd = stat.lastIndexOf(")");
    if (commandEnd < 0) return null;
    const starttimeTicks = stat
      .slice(commandEnd + 1)
      .trim()
      .split(/\s+/u)[19];
    const btimeSeconds = readFileSync("/proc/stat", "utf8").match(/^btime\s+(\d+)$/mu)?.[1];
    if (!starttimeTicks || !/^\d+$/u.test(starttimeTicks) || !btimeSeconds) return null;
    const timestamp = Math.floor(Number(btimeSeconds) * 1000 + (Number(starttimeTicks) * 1000) / 100);
    return Number.isSafeInteger(timestamp) && timestamp > 0 ? timestamp : null;
  } catch {
    return null;
  }
}

export function readProcessCreationTimestampMs(pid?: number): number | null {
  const targetPid = pid ?? process.pid;
  if (!Number.isSafeInteger(targetPid) || targetPid <= 0) return null;
  if (targetPid === process.pid && hasRuntimeCreationTimeApi()) {
    return readRuntimeCreationTimestampMs();
  }
  if (process.platform === "linux") {
    const timestamp = readLinuxCreationTimestampMs(targetPid);
    if (timestamp !== null) return timestamp;
  }
  return targetPid === process.pid ? currentProcessCreationTimestampMs : null;
}
