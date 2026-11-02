import { MANAGED_PROCESS_TOOL_NAMES } from "../managed-process/tool-names";

const LEGACY_CODING_TOOL_NAMES = ["read", "bash", "edit", "write", "grep", "find", "ls"] as const;

export const CODING_TOOL_NAMES = [...LEGACY_CODING_TOOL_NAMES, ...MANAGED_PROCESS_TOOL_NAMES] as const;

export type CodingToolName = (typeof CODING_TOOL_NAMES)[number];

const CODING_TOOL_NAME_SET = new Set<string>(CODING_TOOL_NAMES);

export function isCodingToolName(name: string): name is CodingToolName {
  return CODING_TOOL_NAME_SET.has(name);
}

export type ToolIntent =
  { readonly kind: "bare" } | { readonly kind: "agent"; readonly coding: "all" | readonly CodingToolName[] };

export const BARE_TOOL_INTENT: ToolIntent = { kind: "bare" };

export const DEFAULT_TOOL_INTENT: ToolIntent = { kind: "agent", coding: "all" };

function normalizeCodingSelection(names: readonly string[]): "all" | readonly CodingToolName[] {
  const selected = CODING_TOOL_NAMES.filter((name) => names.includes(name));
  return selected.length === CODING_TOOL_NAMES.length ? "all" : selected;
}

function readCodingSelection(value: unknown): "all" | readonly CodingToolName[] | undefined {
  if (value === "all") return "all";
  if (!Array.isArray(value) || !value.every((name) => typeof name === "string")) return undefined;
  return normalizeCodingSelection(value as string[]);
}

export function toolIntentFromNames(names: readonly string[]): ToolIntent {
  const normalized = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  if (normalized.length === 0) return BARE_TOOL_INTENT;
  if (
    LEGACY_CODING_TOOL_NAMES.every((name) => normalized.includes(name)) &&
    !MANAGED_PROCESS_TOOL_NAMES.some((name) => normalized.includes(name))
  )
    return DEFAULT_TOOL_INTENT;
  return { kind: "agent", coding: normalizeCodingSelection(normalized.filter((name) => isCodingToolName(name))) };
}

export function readToolIntent(value: unknown): ToolIntent | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as { kind?: unknown; coding?: unknown };
  if (record.kind === "bare") return BARE_TOOL_INTENT;
  if (record.kind !== "agent") return undefined;
  const coding = readCodingSelection(record.coding);
  return coding === undefined ? undefined : { kind: "agent", coding };
}

export interface ToolIntentStore {
  get(sessionId: string): ToolIntent | undefined;
  set(sessionId: string, intent: ToolIntent): void;
}

export function adoptBirthToolIntent(
  store: ToolIntentStore,
  sessionId: string,
  birth: { requested?: ToolIntent | readonly string[]; legacy?: readonly string[] },
): ToolIntent {
  const existing = store.get(sessionId);
  if (existing) return existing;
  const requested = birth.requested;
  const adopted =
    (requested ? ("kind" in requested ? requested : toolIntentFromNames(requested)) : undefined) ??
    (birth.legacy ? toolIntentFromNames(birth.legacy) : undefined) ??
    DEFAULT_TOOL_INTENT;
  store.set(sessionId, adopted);
  return adopted;
}
