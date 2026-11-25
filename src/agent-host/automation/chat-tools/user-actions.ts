import {
  summarizeTriggers,
  type AutomationChatCard,
  type AutomationUserAction,
} from "../../../shared/automation/chat-tools";
import { isAutomationSecretName } from "../../../shared/automation/secret-name";
import type { Json } from "../../../shared/automation/spec";
import type { AttentionAction } from "../../../shared/automation/views";
import type { AutomationChatHostContext } from "./context";
import {
  findTaskSummary,
  requireNonNegativeInt,
  requirePositiveInt,
  requireText,
  type AutomationServiceOutcome,
} from "./inspect";

export interface RequestUserActionInput {
  readonly action: AutomationUserAction;
  readonly reason: string;
  readonly taskId?: string;
  readonly revision?: number;
  readonly planHash?: string;
  readonly triggerId?: string;
  readonly input?: Json;
  readonly runId?: string;
  readonly stepIndex?: number;
  readonly expectedVersion?: number;
  readonly suggestedAttentionAction?: AttentionAction;
  readonly signalName?: string;
  readonly signalKey?: string;
  readonly signalPayload?: Json;
  readonly secretName?: string;
  readonly secretOperation?: "set" | "delete";
}

function requireExactSignalKey(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 1024 || /[\0\r\n]/.test(value)) {
    throw new Error("Missing or invalid required string: signalKey");
  }
  return value;
}

export function requestAutomationUserAction(
  ctx: AutomationChatHostContext,
  input: RequestUserActionInput,
): AutomationServiceOutcome {
  const reason = requireText(input.reason, "reason").slice(0, 300);
  switch (input.action) {
    case "enable_task": {
      const taskId = requireText(input.taskId, "taskId");
      const revision = requirePositiveInt(input.revision, "revision");
      const planHash = requireText(input.planHash, "planHash");
      const task = ctx.runtime.getTask(taskId, revision);
      if (task.planHash !== planHash) {
        throw new Error(`Plan hash mismatch for task '${taskId}' revision ${revision}. Inspect the latest task first.`);
      }
      const card: AutomationChatCard = {
        kind: "enable_task",
        taskId: task.taskId,
        taskName: task.source.name,
        revision: task.revision,
        planHash: task.planHash,
        reason,
        cwd: task.source.cwd,
        triggers: summarizeTriggers(task.source.triggers),
        stepCount: task.source.steps.length,
        requiredGrant: task.requiredGrant,
      };
      return {
        payload: { cardEmitted: true, action: "enable_task", taskId: task.taskId, revision: task.revision },
        details: { automationCard: card, targetTaskId: task.taskId, targetTaskName: task.source.name, summary: reason },
      };
    }
    case "start_run": {
      const taskId = requireText(input.taskId, "taskId");
      const triggerId = requireText(input.triggerId, "triggerId");
      const summary = findTaskSummary(ctx, taskId);
      if (!summary) throw new Error(`Task '${taskId}' not found.`);
      if (summary.enabledRevision === null) {
        throw new Error(`Task '${taskId}' is currently disabled. Ask the user to enable it before running.`);
      }
      const revision = ctx.runtime.getTask(taskId, summary.enabledRevision);
      if (!revision.source.triggers.some((trigger) => trigger.id === triggerId)) {
        throw new Error(`Trigger '${triggerId}' does not exist in enabled revision ${summary.enabledRevision}.`);
      }
      const card: AutomationChatCard = {
        kind: "start_run",
        taskId: summary.id,
        taskName: summary.name,
        revision: summary.enabledRevision,
        triggerId,
        input: input.input === undefined ? null : input.input,
        reason,
      };
      return {
        payload: {
          cardEmitted: true,
          action: "start_run",
          taskId: summary.id,
          revision: summary.enabledRevision,
          triggerId,
        },
        details: { automationCard: card, targetTaskId: summary.id, targetTaskName: summary.name, summary: reason },
      };
    }
    case "delete_task": {
      const taskId = requireText(input.taskId, "taskId");
      const summary = findTaskSummary(ctx, taskId);
      if (!summary) throw new Error(`Task '${taskId}' not found.`);
      const card: AutomationChatCard = {
        kind: "delete_task",
        taskId: summary.id,
        taskName: summary.name,
        enabledRevision: summary.enabledRevision,
        reason,
      };
      return {
        payload: { cardEmitted: true, action: "delete_task", taskId: summary.id },
        details: { automationCard: card, targetTaskId: summary.id, targetTaskName: summary.name, summary: reason },
      };
    }
    case "resolve_approval": {
      const runId = requireText(input.runId, "runId");
      const stepIndex = requireNonNegativeInt(input.stepIndex, "stepIndex");
      const expectedVersion = requirePositiveInt(input.expectedVersion, "expectedVersion");
      const item = ctx.runtime
        .listInbox()
        .find(
          (entry) =>
            entry.kind === "approval" &&
            entry.runId === runId &&
            entry.stepIndex === stepIndex &&
            entry.expectedVersion === expectedVersion,
        );
      if (!item || item.kind !== "approval") {
        throw new Error(
          `No matching pending approval for run '${runId}' step ${stepIndex} version ${expectedVersion}.`,
        );
      }
      const card: AutomationChatCard = {
        kind: "resolve_approval",
        taskId: item.taskId,
        taskName: item.taskName,
        runId: item.runId,
        stepIndex: item.stepIndex,
        expectedVersion: item.expectedVersion,
        title: item.title,
        prompt: item.prompt,
        show: item.show,
        fields: item.fields,
        defaults: item.defaults,
        expiresAtMs: item.expiresAtMs,
        reason,
      };
      return {
        payload: { cardEmitted: true, action: "resolve_approval", runId: item.runId, stepIndex: item.stepIndex },
        details: {
          automationCard: card,
          targetTaskId: item.taskId,
          targetTaskName: item.taskName,
          targetRunId: item.runId,
          summary: reason,
        },
      };
    }
    case "resolve_attention": {
      const runId = requireText(input.runId, "runId");
      const stepIndex = requireNonNegativeInt(input.stepIndex, "stepIndex");
      const expectedVersion = requirePositiveInt(input.expectedVersion, "expectedVersion");
      const item = ctx.runtime
        .listInbox()
        .find(
          (entry) =>
            entry.kind === "attention" &&
            entry.runId === runId &&
            entry.stepIndex === stepIndex &&
            entry.expectedVersion === expectedVersion,
        );
      if (!item || item.kind !== "attention") {
        throw new Error(`No matching attention item for run '${runId}' step ${stepIndex} version ${expectedVersion}.`);
      }
      const card: AutomationChatCard = {
        kind: "resolve_attention",
        taskId: item.taskId,
        taskName: item.taskName,
        runId: item.runId,
        stepIndex: item.stepIndex,
        expectedVersion: item.expectedVersion,
        stepId: item.stepId,
        error: item.error,
        suggestedAction: input.suggestedAttentionAction ?? null,
        reason,
      };
      return {
        payload: { cardEmitted: true, action: "resolve_attention", runId: item.runId, stepIndex: item.stepIndex },
        details: {
          automationCard: card,
          targetTaskId: item.taskId,
          targetTaskName: item.taskName,
          targetRunId: item.runId,
          summary: reason,
        },
      };
    }
    case "emit_signal": {
      const taskId = requireText(input.taskId, "taskId");
      const signalName = requireText(input.signalName, "signalName");
      const signalKey = requireExactSignalKey(input.signalKey);
      const summary = findTaskSummary(ctx, taskId);
      if (!summary) throw new Error(`Task '${taskId}' not found.`);
      const card: AutomationChatCard = {
        kind: "emit_signal",
        taskId: summary.id,
        taskName: summary.name,
        signalName,
        signalKey,
        payload: input.signalPayload === undefined ? null : input.signalPayload,
        reason,
      };
      return {
        payload: { cardEmitted: true, action: "emit_signal", taskId: summary.id, signalName, signalKey },
        details: { automationCard: card, targetTaskId: summary.id, targetTaskName: summary.name, summary: reason },
      };
    }
    case "configure_secret": {
      const secretName = requireText(input.secretName, "secretName");
      if (!isAutomationSecretName(secretName)) {
        throw new Error("Invalid secretName: must match /^[a-z0-9._-]{1,80}$/ (lowercase only).");
      }
      const operation = input.secretOperation === "delete" ? "delete" : "set";
      const card: AutomationChatCard = {
        kind: "configure_secret",
        secretName,
        operation,
        reason,
      };
      return {
        payload: { cardEmitted: true, action: "configure_secret", secretName, operation },
        details: { automationCard: card, summary: secretName },
      };
    }
  }
}
