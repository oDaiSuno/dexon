export const CODEMODE_TOOL_NAME = "codemode" as const;

export const DEFAULT_CODEMODE_ENABLED = true;

export const DEFAULT_CODEMODE_MODE = "on" as const;

export type CodemodeMode = "on" | "only";

export type CodemodeAvailability =
  | { readonly available: true }
  | {
      readonly available: false;
      readonly reason: "missing_sandbox" | "unsupported" | "error";
      readonly detail?: string;
    };

export interface CodemodeProjectOverride {
  readonly filePath: string;
  readonly enabled?: boolean;
  readonly mode?: CodemodeMode;
}

export interface CodemodeSettingsResult {
  readonly enabled: boolean;
  readonly mode: CodemodeMode;
  readonly configPath: string;
  readonly availability: CodemodeAvailability;
  readonly projectOverride: CodemodeProjectOverride | null;
}

export interface CodemodeSettingsPatch {
  readonly enabled?: boolean;
  readonly mode?: CodemodeMode;
  readonly cwd?: string;
}

export type CodemodeNestedCallStatus = "running" | "ok" | "error" | "cancelled";

export interface CodemodeNestedCall {
  readonly id: string;
  readonly name: string;
  readonly args: string;
  readonly status: CodemodeNestedCallStatus;
  readonly durationMs?: number;
  readonly error?: string;
  readonly cost?: number;
}

export interface CodemodeToolDetails {
  readonly calls: readonly CodemodeNestedCall[];
  readonly fullOutputPath?: string;
}

export function isCodemodeToolName(name: string): boolean {
  return name === CODEMODE_TOOL_NAME;
}

export function normalizeCodemodeMode(value: unknown): CodemodeMode {
  return value === "only" ? "only" : DEFAULT_CODEMODE_MODE;
}

function isNestedCallStatus(value: unknown): value is CodemodeNestedCallStatus {
  return value === "running" || value === "ok" || value === "error" || value === "cancelled";
}

export function parseCodemodeDetails(details: unknown): CodemodeToolDetails | null {
  if (!details || typeof details !== "object") return null;
  const record = details as Record<string, unknown>;
  if (!Array.isArray(record.calls)) return null;
  const calls: CodemodeNestedCall[] = [];
  for (const item of record.calls) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const id = typeof entry.id === "string" ? entry.id : "";
    const name = typeof entry.name === "string" ? entry.name : "";
    if (!name) continue;
    const args = typeof entry.args === "string" ? entry.args : "";
    const status: CodemodeNestedCallStatus = isNestedCallStatus(entry.status) ? entry.status : "running";
    const durationMs =
      typeof entry.durationMs === "number" && Number.isFinite(entry.durationMs) && entry.durationMs >= 0
        ? entry.durationMs
        : undefined;
    const error = typeof entry.error === "string" && entry.error.length > 0 ? entry.error : undefined;
    const cost =
      typeof entry.cost === "number" && Number.isFinite(entry.cost) && entry.cost >= 0 ? entry.cost : undefined;
    calls.push({
      id: id || `${name}-${calls.length}`,
      name,
      args,
      status,
      ...(durationMs !== undefined ? { durationMs } : {}),
      ...(error !== undefined ? { error } : {}),
      ...(cost !== undefined ? { cost } : {}),
    });
  }
  const fullOutputPath =
    typeof record.fullOutputPath === "string" && record.fullOutputPath.trim().length > 0
      ? record.fullOutputPath
      : undefined;
  return {
    calls,
    ...(fullOutputPath !== undefined ? { fullOutputPath } : {}),
  };
}
