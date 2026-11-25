import { summarizeTriggers, type AutomationChatCard } from "../../../shared/automation/chat-tools";
import type { RequiredGrant, TaskSpec } from "../../../shared/automation/spec";
import type { TaskRevisionView, TaskView } from "../../../shared/automation/views";
import { deriveRequiredGrant, hashScriptManifest } from "../spec/grant";
import { normalizeTaskSpec } from "../spec/normalize";
import { assertTaskSpec, SpecValidationError, type SpecIssue } from "../spec/validate";
import type { AutomationChatHostContext } from "./context";
import { findTaskSummary, requireText, type AutomationServiceOutcome } from "./inspect";

export interface ValidateInput {
  readonly mode: "create" | "update";
  readonly expectedRevision?: number;
  readonly spec: unknown;
}

export interface SaveDraftInput extends ValidateInput {
  readonly summary: string;
}

export interface StopInput {
  readonly action: "disable_task" | "cancel_run";
  readonly taskId?: string;
  readonly runId?: string;
  readonly reason?: string;
}

function diffSets(previous: readonly string[], next: readonly string[]): string[] {
  const prev = new Set(previous);
  return next.filter((item) => !prev.has(item));
}

function computeImpact(previous: TaskRevisionView | null, previousSummary: TaskView | null, next: RequiredGrant) {
  const prevGrant = previous?.requiredGrant;
  const prevTargets = (prevGrant?.channelTargets ?? []).map((item) => `${item.accountId}:${item.peerId}`);
  const nextTargets = next.channelTargets.map((item) => `${item.accountId}:${item.peerId}`);
  const prevScripts = (prevGrant?.scripts ?? []).map((item) => `${item.path}@${item.sha256}`);
  const nextScripts = next.scripts.map((item) => `${item.path}@${item.sha256}`);
  return {
    disarmsEnabledRevision: previousSummary?.enabledRevision ?? null,
    addedHttpOrigins: diffSets(prevGrant?.httpOrigins ?? [], next.httpOrigins),
    addedSecrets: diffSets(prevGrant?.secrets ?? [], next.secrets),
    addedAgentTools: diffSets(prevGrant?.agentTools ?? [], next.agentTools),
    addedChannelTargets: diffSets(prevTargets, nextTargets),
    addedOrChangedScripts: diffSets(prevScripts, nextScripts),
    requiresTrustedLocalExecution: next.requiresTrustedLocalExecution,
    unattendedWriteCount: next.unattendedWrites.length,
  };
}

function dryRunValidate(
  ctx: AutomationChatHostContext,
  input: ValidateInput,
):
  | {
      readonly valid: true;
      readonly spec: TaskSpec;
      readonly planHash: string;
      readonly requiredGrant: RequiredGrant;
      readonly previousSummary: TaskView | null;
      readonly previousRevision: TaskRevisionView | null;
      readonly impact: ReturnType<typeof computeImpact>;
    }
  | { readonly valid: false; readonly issues: readonly SpecIssue[] } {
  try {
    assertTaskSpec(input.spec);
  } catch (error) {
    if (error instanceof SpecValidationError) return { valid: false, issues: error.issues };
    return {
      valid: false,
      issues: [{ path: "$", code: "invalid", message: error instanceof Error ? error.message : String(error) }],
    };
  }
  const spec = input.spec;
  const existing = findTaskSummary(ctx, spec.id);
  if (input.mode === "create" && existing) {
    return {
      valid: false,
      issues: [
        {
          path: "id",
          code: "already_exists",
          message: `Task '${spec.id}' already exists (revision ${existing.currentRevision}). Use mode 'update' with expectedRevision ${existing.currentRevision} or choose a new id.`,
        },
      ],
    };
  }
  if (input.mode === "update") {
    if (!existing) {
      return {
        valid: false,
        issues: [{ path: "id", code: "not_found", message: `Task '${spec.id}' does not exist.` }],
      };
    }
    if (input.expectedRevision !== existing.currentRevision) {
      return {
        valid: false,
        issues: [
          {
            path: "expectedRevision",
            code: "revision_conflict",
            message: `Expected revision ${input.expectedRevision ?? "missing"}, but current revision is ${existing.currentRevision}.`,
          },
        ],
      };
    }
  }
  let scriptHashes: Readonly<Record<string, string>>;
  try {
    scriptHashes = hashScriptManifest(spec);
  } catch (error) {
    return {
      valid: false,
      issues: [{ path: "steps", code: "script", message: error instanceof Error ? error.message : String(error) }],
    };
  }
  try {
    const plan = normalizeTaskSpec(spec, { scriptHashes });
    const requiredGrant = deriveRequiredGrant(plan, spec, { scriptHashes });
    const previousRevision = existing ? ctx.runtime.getTask(existing.id, existing.currentRevision) : null;
    return {
      valid: true,
      spec,
      planHash: requiredGrant.planHash,
      requiredGrant,
      previousSummary: existing,
      previousRevision,
      impact: computeImpact(previousRevision, existing, requiredGrant),
    };
  } catch (error) {
    if (error instanceof SpecValidationError) return { valid: false, issues: error.issues };
    return {
      valid: false,
      issues: [{ path: "$", code: "compile", message: error instanceof Error ? error.message : String(error) }],
    };
  }
}

export function validateAutomationSpec(ctx: AutomationChatHostContext, input: ValidateInput): AutomationServiceOutcome {
  const checked = dryRunValidate(ctx, input);
  if (!checked.valid) {
    return {
      payload: { valid: false, issues: checked.issues },
      details: { summary: `${checked.issues.length} validation issues` },
    };
  }
  return {
    payload: {
      valid: true,
      taskId: checked.spec.id,
      planHash: checked.planHash,
      requiredGrant: checked.requiredGrant,
      impact: checked.impact,
    },
    details: { targetTaskId: checked.spec.id, targetTaskName: checked.spec.name, summary: "valid" },
  };
}

export async function saveAutomationDraft(
  ctx: AutomationChatHostContext,
  input: SaveDraftInput,
): Promise<AutomationServiceOutcome> {
  const summary = requireText(input.summary, "summary").slice(0, 300);
  const checked = dryRunValidate(ctx, input);
  if (!checked.valid) {
    throw new Error(
      `Validation failed: ${checked.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`,
    );
  }
  const saved = await ctx.runtime.saveTask(checked.spec);
  const card: AutomationChatCard = {
    kind: "draft_saved",
    mode: input.mode,
    taskId: saved.task.id,
    taskName: saved.task.name,
    revision: saved.revision,
    planHash: saved.planHash,
    summary,
    cwd: checked.spec.cwd,
    disarmedPreviousRevision: checked.impact.disarmsEnabledRevision,
    triggers: summarizeTriggers(checked.spec.triggers),
    stepCount: checked.spec.steps.length,
    requiredGrant: saved.requiredGrant,
  };
  return {
    payload: {
      saved: true,
      enabled: false,
      taskId: saved.task.id,
      taskName: saved.task.name,
      revision: saved.revision,
      planHash: saved.planHash,
      disarmedPreviousRevision: checked.impact.disarmsEnabledRevision,
      requiredGrant: saved.requiredGrant,
      nextStep:
        "Draft saved as unenabled revision. A review card is now shown to the user so they can configure any missing secrets and click Review & Enable.",
    },
    details: {
      automationCard: card,
      targetTaskId: saved.task.id,
      targetTaskName: saved.task.name,
      summary,
    },
  };
}

export async function stopAutomation(
  ctx: AutomationChatHostContext,
  input: StopInput,
): Promise<AutomationServiceOutcome> {
  if (input.action === "disable_task") {
    const taskId = requireText(input.taskId, "taskId");
    const task = ctx.runtime.disableTask(taskId);
    return {
      payload: {
        action: "disable_task",
        taskId: task.id,
        taskName: task.name,
        enabledRevision: task.enabledRevision,
        ...(input.reason ? { reason: input.reason } : {}),
      },
      details: { targetTaskId: task.id, targetTaskName: task.name, summary: "disabled" },
    };
  }
  const runId = requireText(input.runId, "runId");
  const run = await ctx.runtime.cancelRun(runId);
  return {
    payload: {
      action: "cancel_run",
      runId: run.id,
      taskId: run.taskId,
      phase: run.phase,
      ...(input.reason ? { reason: input.reason } : {}),
    },
    details: { targetTaskId: run.taskId, targetRunId: run.id, summary: run.phase },
  };
}
