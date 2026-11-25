import type { Json, JsonSchema, RequiredGrant, TriggerSpec } from "./spec";
import type { AttentionAction } from "./views";
import { ATTENTION_ACTIONS } from "./views";

export const AUTOMATION_CHAT_TOOL_NAMES = [
  "automation_inspect",
  "automation_guide",
  "automation_validate",
  "automation_save_draft",
  "automation_stop",
  "automation_request_user_action",
] as const;

export type AutomationChatToolName = (typeof AUTOMATION_CHAT_TOOL_NAMES)[number];

const AUTOMATION_CHAT_TOOL_NAME_SET = new Set<string>(AUTOMATION_CHAT_TOOL_NAMES);

export function isAutomationChatToolName(name: string): name is AutomationChatToolName {
  return AUTOMATION_CHAT_TOOL_NAME_SET.has(name);
}

export const AUTOMATION_GUIDE_TOPICS = ["core", "triggers", "steps", "expressions", "recipes"] as const;
export type AutomationGuideTopic = (typeof AUTOMATION_GUIDE_TOPICS)[number];

export const AUTOMATION_USER_ACTIONS = [
  "enable_task",
  "start_run",
  "delete_task",
  "resolve_approval",
  "resolve_attention",
  "emit_signal",
  "configure_secret",
] as const;
export type AutomationUserAction = (typeof AUTOMATION_USER_ACTIONS)[number];

export type AutomationTriggerSummary =
  | { readonly id: string; readonly kind: "manual" }
  | {
      readonly id: string;
      readonly kind: "schedule";
      readonly cron?: string;
      readonly tz?: string;
      readonly every?: string;
    }
  | {
      readonly id: string;
      readonly kind: "watch";
      readonly every: string;
      readonly mode: "threshold" | "items";
      readonly probeKind: "http.request" | "script.run";
    };

export function summarizeTriggers(triggers: readonly TriggerSpec[]): AutomationTriggerSummary[] {
  return triggers.map((trigger) => {
    if (trigger.kind === "manual") return { id: trigger.id, kind: "manual" };
    if (trigger.kind === "schedule") {
      return {
        id: trigger.id,
        kind: "schedule",
        ...("cron" in trigger
          ? { cron: trigger.cron, ...(trigger.tz ? { tz: trigger.tz } : {}) }
          : { every: trigger.every }),
      };
    }
    return {
      id: trigger.id,
      kind: "watch",
      every: trigger.every,
      mode: trigger.mode.type,
      probeKind: trigger.probe.action,
    };
  });
}

export type AutomationChatCard =
  | {
      readonly kind: "draft_saved";
      readonly mode: "create" | "update";
      readonly taskId: string;
      readonly taskName: string;
      readonly revision: number;
      readonly planHash: string;
      readonly summary: string;
      readonly cwd: string;
      readonly disarmedPreviousRevision: number | null;
      readonly triggers: readonly AutomationTriggerSummary[];
      readonly stepCount: number;
      readonly requiredGrant: RequiredGrant;
    }
  | {
      readonly kind: "enable_task";
      readonly taskId: string;
      readonly taskName: string;
      readonly revision: number;
      readonly planHash: string;
      readonly reason: string;
      readonly cwd: string;
      readonly triggers: readonly AutomationTriggerSummary[];
      readonly stepCount: number;
      readonly requiredGrant: RequiredGrant;
    }
  | {
      readonly kind: "start_run";
      readonly taskId: string;
      readonly taskName: string;
      readonly triggerId: string;
      readonly input: Json;
      readonly reason: string;
    }
  | {
      readonly kind: "delete_task";
      readonly taskId: string;
      readonly taskName: string;
      readonly enabledRevision: number | null;
      readonly reason: string;
    }
  | {
      readonly kind: "resolve_approval";
      readonly taskId: string;
      readonly taskName: string;
      readonly runId: string;
      readonly stepIndex: number;
      readonly expectedVersion: number;
      readonly title: string;
      readonly prompt: string | null;
      readonly show: Json | null;
      readonly fields: JsonSchema | null;
      readonly defaults: Json | null;
      readonly expiresAtMs: number | null;
      readonly reason: string;
    }
  | {
      readonly kind: "resolve_attention";
      readonly taskId: string;
      readonly taskName: string;
      readonly runId: string;
      readonly stepIndex: number;
      readonly expectedVersion: number;
      readonly stepId: string;
      readonly error: Json;
      readonly suggestedAction: AttentionAction | null;
      readonly reason: string;
    }
  | {
      readonly kind: "emit_signal";
      readonly taskId: string;
      readonly taskName: string;
      readonly signalName: string;
      readonly signalKey: string;
      readonly payload: Json;
      readonly reason: string;
    }
  | {
      readonly kind: "configure_secret";
      readonly secretName: string;
      readonly operation: "set" | "delete";
      readonly reason: string;
    };

export interface AutomationToolDetails {
  readonly automationCard?: AutomationChatCard;
  readonly targetTaskId?: string;
  readonly targetTaskName?: string;
  readonly targetRunId?: string;
  readonly summary?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function positiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function nonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRequiredGrant(value: unknown): value is RequiredGrant {
  if (!isRecord(value)) return false;
  return (
    nonEmptyString(value.cwd) &&
    nonEmptyString(value.planHash) &&
    Array.isArray(value.agentTools) &&
    Array.isArray(value.channelTargets) &&
    Array.isArray(value.httpOrigins) &&
    Array.isArray(value.scripts) &&
    Array.isArray(value.secrets) &&
    Array.isArray(value.unattendedWrites) &&
    typeof value.requiresTrustedLocalExecution === "boolean"
  );
}

function isAttentionAction(value: unknown): value is AttentionAction {
  return typeof value === "string" && (ATTENTION_ACTIONS as readonly string[]).includes(value);
}

export function readAutomationChatCard(details: unknown): AutomationChatCard | null {
  if (!isRecord(details)) return null;
  const card = details.automationCard;
  if (!isRecord(card) || typeof card.kind !== "string") return null;
  switch (card.kind) {
    case "draft_saved":
      if (
        (card.mode === "create" || card.mode === "update") &&
        nonEmptyString(card.taskId) &&
        nonEmptyString(card.taskName) &&
        positiveInt(card.revision) &&
        nonEmptyString(card.planHash) &&
        nonEmptyString(card.summary) &&
        nonEmptyString(card.cwd) &&
        (card.disarmedPreviousRevision === null || positiveInt(card.disarmedPreviousRevision)) &&
        Array.isArray(card.triggers) &&
        positiveInt(card.stepCount) &&
        isRequiredGrant(card.requiredGrant)
      ) {
        return card as unknown as AutomationChatCard;
      }
      return null;
    case "enable_task":
      if (
        nonEmptyString(card.taskId) &&
        nonEmptyString(card.taskName) &&
        positiveInt(card.revision) &&
        nonEmptyString(card.planHash) &&
        nonEmptyString(card.reason) &&
        nonEmptyString(card.cwd) &&
        Array.isArray(card.triggers) &&
        positiveInt(card.stepCount) &&
        isRequiredGrant(card.requiredGrant)
      ) {
        return card as unknown as AutomationChatCard;
      }
      return null;
    case "start_run":
      if (
        nonEmptyString(card.taskId) &&
        nonEmptyString(card.taskName) &&
        nonEmptyString(card.triggerId) &&
        nonEmptyString(card.reason)
      ) {
        return card as unknown as AutomationChatCard;
      }
      return null;
    case "delete_task":
      if (
        nonEmptyString(card.taskId) &&
        nonEmptyString(card.taskName) &&
        (card.enabledRevision === null || positiveInt(card.enabledRevision)) &&
        nonEmptyString(card.reason)
      ) {
        return card as unknown as AutomationChatCard;
      }
      return null;
    case "resolve_approval":
      if (
        nonEmptyString(card.taskId) &&
        nonEmptyString(card.taskName) &&
        nonEmptyString(card.runId) &&
        nonNegativeInt(card.stepIndex) &&
        positiveInt(card.expectedVersion) &&
        nonEmptyString(card.title) &&
        nonEmptyString(card.reason)
      ) {
        return card as unknown as AutomationChatCard;
      }
      return null;
    case "resolve_attention":
      if (
        nonEmptyString(card.taskId) &&
        nonEmptyString(card.taskName) &&
        nonEmptyString(card.runId) &&
        nonNegativeInt(card.stepIndex) &&
        positiveInt(card.expectedVersion) &&
        nonEmptyString(card.stepId) &&
        (card.suggestedAction === null || isAttentionAction(card.suggestedAction)) &&
        nonEmptyString(card.reason)
      ) {
        return card as unknown as AutomationChatCard;
      }
      return null;
    case "emit_signal":
      if (
        nonEmptyString(card.taskId) &&
        nonEmptyString(card.taskName) &&
        nonEmptyString(card.signalName) &&
        nonEmptyString(card.signalKey) &&
        nonEmptyString(card.reason)
      ) {
        return card as unknown as AutomationChatCard;
      }
      return null;
    case "configure_secret":
      if (
        nonEmptyString(card.secretName) &&
        (card.operation === "set" || card.operation === "delete") &&
        nonEmptyString(card.reason)
      ) {
        return card as unknown as AutomationChatCard;
      }
      return null;
    default:
      return null;
  }
}

export function readAutomationToolDetails(details: unknown): AutomationToolDetails | null {
  if (!isRecord(details)) return null;
  const automationCard = readAutomationChatCard(details) ?? undefined;
  const targetTaskId = nonEmptyString(details.targetTaskId) ? details.targetTaskId : undefined;
  const targetTaskName = nonEmptyString(details.targetTaskName) ? details.targetTaskName : undefined;
  const targetRunId = nonEmptyString(details.targetRunId) ? details.targetRunId : undefined;
  const summary = nonEmptyString(details.summary) ? details.summary : undefined;
  if (!automationCard && !targetTaskId && !targetTaskName && !targetRunId && !summary) return null;
  return {
    ...(automationCard ? { automationCard } : {}),
    ...(targetTaskId ? { targetTaskId } : {}),
    ...(targetTaskName ? { targetTaskName } : {}),
    ...(targetRunId ? { targetRunId } : {}),
    ...(summary ? { summary } : {}),
  };
}
