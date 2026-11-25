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
      readonly revision: number;
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

const AGENT_WORKSPACE_TOOL_SET = new Set<string>(["read", "write", "edit", "bash", "grep", "find"]);
const UNATTENDED_WRITE_KIND_SET = new Set<string>(["channel_send", "http_write", "script_write", "agent_write"]);
const STEP_EFFECT_KIND_SET = new Set<string>(["read", "idempotent", "unsafe"]);

function isJsonValue(value: unknown): value is Json {
  if (value === null || typeof value === "boolean" || typeof value === "string") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (isRecord(value)) return Object.values(value).every(isJsonValue);
  return false;
}

function isJsonObject(value: unknown): value is JsonSchema {
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function isChannelTarget(value: unknown): boolean {
  return isRecord(value) && nonEmptyString(value.accountId) && nonEmptyString(value.peerId);
}

function isScriptGrant(value: unknown): boolean {
  return isRecord(value) && nonEmptyString(value.path) && nonEmptyString(value.sha256);
}

function isUnattendedWrite(value: unknown): boolean {
  return (
    isRecord(value) &&
    nonEmptyString(value.stepId) &&
    typeof value.kind === "string" &&
    UNATTENDED_WRITE_KIND_SET.has(value.kind)
  );
}

function isStepEffect(value: unknown): boolean {
  return (
    isRecord(value) &&
    nonEmptyString(value.stepId) &&
    typeof value.effect === "string" &&
    STEP_EFFECT_KIND_SET.has(value.effect)
  );
}

function isTriggerSummary(value: unknown): value is AutomationTriggerSummary {
  if (!isRecord(value) || !nonEmptyString(value.id) || typeof value.kind !== "string") return false;
  if (value.kind === "manual") return true;
  if (value.kind === "schedule") {
    const hasCron = nonEmptyString(value.cron) && (value.tz === undefined || nonEmptyString(value.tz));
    const hasEvery = nonEmptyString(value.every);
    return (hasCron && value.every === undefined) || (hasEvery && value.cron === undefined && value.tz === undefined);
  }
  if (value.kind === "watch") {
    return (
      nonEmptyString(value.every) &&
      (value.mode === "threshold" || value.mode === "items") &&
      (value.probeKind === "http.request" || value.probeKind === "script.run")
    );
  }
  return false;
}

function isRequiredGrant(value: unknown): value is RequiredGrant {
  if (!isRecord(value)) return false;
  return (
    nonEmptyString(value.cwd) &&
    nonEmptyString(value.planHash) &&
    Array.isArray(value.agentTools) &&
    value.agentTools.every((item) => typeof item === "string" && AGENT_WORKSPACE_TOOL_SET.has(item)) &&
    Array.isArray(value.channelTargets) &&
    value.channelTargets.every(isChannelTarget) &&
    Array.isArray(value.allowedChannelTargets) &&
    value.allowedChannelTargets.every(isChannelTarget) &&
    Array.isArray(value.httpOrigins) &&
    value.httpOrigins.every(nonEmptyString) &&
    Array.isArray(value.scripts) &&
    value.scripts.every(isScriptGrant) &&
    Array.isArray(value.secrets) &&
    value.secrets.every(nonEmptyString) &&
    Array.isArray(value.unattendedWrites) &&
    value.unattendedWrites.every(isUnattendedWrite) &&
    Array.isArray(value.stepEffects) &&
    value.stepEffects.every(isStepEffect) &&
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
        card.triggers.every(isTriggerSummary) &&
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
        card.triggers.every(isTriggerSummary) &&
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
        positiveInt(card.revision) &&
        nonEmptyString(card.triggerId) &&
        isJsonValue(card.input) &&
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
        (card.prompt === null || typeof card.prompt === "string") &&
        (card.show === null || isJsonValue(card.show)) &&
        (card.fields === null || isJsonObject(card.fields)) &&
        (card.defaults === null || isJsonValue(card.defaults)) &&
        (card.expiresAtMs === null || positiveInt(card.expiresAtMs)) &&
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
        isJsonValue(card.error) &&
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
        isJsonValue(card.payload) &&
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
