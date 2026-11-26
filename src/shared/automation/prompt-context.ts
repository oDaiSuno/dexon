export type AutomationPromptMode = "draft" | "modify" | "adjust";

export interface AutomationPromptBadge {
  readonly mode: AutomationPromptMode;
  readonly taskId?: string;
  readonly taskName?: string;
  readonly revision?: number;
  readonly environmentLabel?: string;
  readonly hasUnsavedChanges?: boolean;
}

export interface AutomationPromptPayload {
  readonly badge: AutomationPromptBadge;
  readonly hiddenContext: string;
}

export const AUTOMATION_PROMPT_LIMITS = {
  taskId: 256,
  taskName: 256,
  environmentLabel: 256,
  hiddenContext: 65_536,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedLabel(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string" || value.length > limit) return undefined;
  const label = value.trim();
  return label && !/[\u0000-\u001f\u007f]/.test(label) ? label : undefined;
}

export function parseAutomationPromptBadge(value: unknown): AutomationPromptBadge | null {
  if (!isRecord(value) || (value.mode !== "draft" && value.mode !== "modify" && value.mode !== "adjust")) return null;
  const taskId = boundedLabel(value.taskId, AUTOMATION_PROMPT_LIMITS.taskId);
  const taskName = boundedLabel(value.taskName, AUTOMATION_PROMPT_LIMITS.taskName);
  const environmentLabel = boundedLabel(value.environmentLabel, AUTOMATION_PROMPT_LIMITS.environmentLabel);
  const revision =
    typeof value.revision === "number" && Number.isSafeInteger(value.revision) && value.revision > 0
      ? value.revision
      : undefined;
  return {
    mode: value.mode,
    ...(taskId ? { taskId } : {}),
    ...(taskName ? { taskName } : {}),
    ...(revision !== undefined ? { revision } : {}),
    ...(environmentLabel ? { environmentLabel } : {}),
    ...(typeof value.hasUnsavedChanges === "boolean" ? { hasUnsavedChanges: value.hasUnsavedChanges } : {}),
  };
}

export function parseAutomationPromptPayload(value: unknown): AutomationPromptPayload | null {
  if (!isRecord(value)) return null;
  const badge = parseAutomationPromptBadge(value.badge);
  if (
    !badge ||
    typeof value.hiddenContext !== "string" ||
    value.hiddenContext.length > AUTOMATION_PROMPT_LIMITS.hiddenContext ||
    !value.hiddenContext.trim()
  )
    return null;
  return { badge, hiddenContext: value.hiddenContext };
}
