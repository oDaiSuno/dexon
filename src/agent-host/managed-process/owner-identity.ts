import type { ManagedProcessOwnerIdentityV1 } from "../../contract/processes.ts";
import fs from "node:fs";
import { readProcessCreationTimestampMs } from "../../shared/process-creation-time.ts";

export interface ManagedProcessOwnerRuntimeIdentity extends ManagedProcessOwnerIdentityV1 {
  hostPid: number;
  hostStartFingerprint: string;
  hostImagePath: string;
}

let identity: ManagedProcessOwnerRuntimeIdentity | null = null;

function electronCreationTime(): number | null {
  return readProcessCreationTimestampMs(process.pid);
}

export function applyManagedProcessOwnerIdentity(value: unknown): ManagedProcessOwnerRuntimeIdentity {
  if (identity) throw new Error("Managed process owner identity is already initialized for this Host generation");
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid managed process owner identity");
  const candidate = value as Record<string, unknown>;
  if (
    candidate.version !== 1 ||
    !Number.isSafeInteger(candidate.mainPid) ||
    (candidate.mainPid as number) <= 1 ||
    typeof candidate.mainStartFingerprint !== "string" ||
    !/^\d{10,16}$/u.test(candidate.mainStartFingerprint) ||
    typeof candidate.mainImagePath !== "string" ||
    !candidate.mainImagePath ||
    candidate.mainImagePath.length > 4_096 ||
    /[\0\r\n]/u.test(candidate.mainImagePath) ||
    typeof candidate.hostInstanceId !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(candidate.hostInstanceId)
  ) {
    throw new Error("Invalid managed process owner identity fields");
  }
  const hostStartTime = electronCreationTime();
  if (!hostStartTime) throw new Error("Host creation time is unavailable");
  identity = {
    version: 1,
    mainPid: candidate.mainPid as number,
    mainStartFingerprint: candidate.mainStartFingerprint,
    mainImagePath: candidate.mainImagePath,
    hostInstanceId: candidate.hostInstanceId,
    hostPid: process.pid,
    hostStartFingerprint: String(hostStartTime),
    hostImagePath: fs.realpathSync.native(process.execPath),
  };
  return { ...identity };
}

export function getManagedProcessOwnerIdentity(): ManagedProcessOwnerRuntimeIdentity | null {
  return identity ? { ...identity } : null;
}
