import type { AutomationToolDetails } from "../../../shared/automation/chat-tools";
import type { RunPhase } from "../../../shared/automation/phases";
import type { TaskView } from "../../../shared/automation/views";
import type { AutomationChatHostContext } from "./context";

const PREVIEW_MAX_CHARS = 1_024;
const STEP_DETAIL_MAX_CHARS = 16_384;
const DEFAULT_RUN_LIMIT = 20;
const MAX_RUN_LIMIT = 50;

export interface InspectInput {
  readonly view: "tasks" | "task" | "runs" | "run" | "inbox" | "capabilities";
  readonly taskId?: string;
  readonly revision?: number;
  readonly cwd?: string;
  readonly runId?: string;
  readonly stepIndex?: number;
  readonly phases?: readonly RunPhase[];
  readonly limit?: number;
  readonly beforeMs?: number;
}

export interface AutomationServiceOutcome {
  readonly payload: Record<string, unknown>;
  readonly details?: AutomationToolDetails;
}

export function findTaskSummary(ctx: AutomationChatHostContext, taskId: string): TaskView | null {
  return ctx.runtime.listTasks().find((task) => task.id === taskId) ?? null;
}

export function requireText(value: string | undefined, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing required field: ${field}`);
  return value.trim();
}

export function requirePositiveInt(value: number | undefined, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Expected integer >= 1 for ${field}`);
  }
  return value;
}

export function requireNonNegativeInt(value: number | undefined, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Expected integer >= 0 for ${field}`);
  }
  return value;
}

function truncateJson(value: unknown, maxChars: number): { readonly value: unknown; readonly truncated: boolean } {
  if (value === null || value === undefined) return { value: null, truncated: false };
  const serialized = JSON.stringify(value);
  if (serialized.length <= maxChars) return { value, truncated: false };
  return {
    value: `${serialized.slice(0, maxChars)}… [truncated ${serialized.length - maxChars} chars]`,
    truncated: true,
  };
}

export async function inspectAutomation(
  ctx: AutomationChatHostContext,
  sessionCwd: string,
  input: InspectInput,
): Promise<AutomationServiceOutcome> {
  switch (input.view) {
    case "tasks": {
      const tasks = ctx.runtime.listTasks(input.cwd ? { cwd: input.cwd } : {});
      return {
        payload: {
          view: "tasks",
          count: tasks.length,
          tasks: tasks.map((task) => ({
            id: task.id,
            name: task.name,
            cwd: task.cwd,
            currentRevision: task.currentRevision,
            enabledRevision: task.enabledRevision,
            updatedAtMs: task.updatedAtMs,
          })),
        },
        details: { summary: `${tasks.length} tasks` },
      };
    }
    case "task": {
      const taskId = requireText(input.taskId, "taskId");
      const summary = findTaskSummary(ctx, taskId);
      const revision = ctx.runtime.getTask(taskId, input.revision);
      return {
        payload: {
          view: "task",
          task: {
            ...revision,
            currentRevision: summary?.currentRevision ?? revision.revision,
            enabledRevision: summary?.enabledRevision ?? null,
          },
        },
        details: { targetTaskId: revision.taskId, targetTaskName: revision.source.name },
      };
    }
    case "runs": {
      const limit = Math.min(Math.max(input.limit ?? DEFAULT_RUN_LIMIT, 1), MAX_RUN_LIMIT);
      const runs = ctx.runtime.listRuns({
        ...(input.taskId ? { taskId: input.taskId } : {}),
        ...(input.phases ? { phases: input.phases } : {}),
        ...(input.beforeMs !== undefined ? { beforeMs: input.beforeMs } : {}),
        limit,
      });
      return {
        payload: { view: "runs", count: runs.length, runs },
        details: { ...(input.taskId ? { targetTaskId: input.taskId } : {}), summary: `${runs.length} runs` },
      };
    }
    case "run": {
      const runId = requireText(input.runId, "runId");
      const run = ctx.runtime.getRun(runId);
      if (input.stepIndex !== undefined) {
        const step = run.steps.find((item) => item.stepIndex === input.stepIndex);
        if (!step) throw new Error(`Step index ${input.stepIndex} not found in run '${runId}'`);
        const attempts = run.attempts.filter((attempt) => attempt.stepIndex === input.stepIndex);
        const output = truncateJson(step.output, STEP_DETAIL_MAX_CHARS);
        const error = truncateJson(step.error, STEP_DETAIL_MAX_CHARS);
        return {
          payload: {
            view: "run",
            runId: run.id,
            taskId: run.taskId,
            phase: run.phase,
            version: run.version,
            step: {
              ...step,
              output: output.value,
              outputTruncated: output.truncated,
              error: error.value,
              errorTruncated: error.truncated,
            },
            attempts,
          },
          details: { targetTaskId: run.taskId, targetRunId: run.id },
        };
      }
      const attemptCounts = new Map<number, number>();
      for (const attempt of run.attempts) {
        attemptCounts.set(attempt.stepIndex, (attemptCounts.get(attempt.stepIndex) ?? 0) + 1);
      }
      return {
        payload: {
          view: "run",
          run: {
            id: run.id,
            taskId: run.taskId,
            revision: run.revision,
            version: run.version,
            phase: run.phase,
            createdAtMs: run.createdAtMs,
            updatedAtMs: run.updatedAtMs,
            endedAtMs: run.endedAtMs,
            end: truncateJson(run.end, PREVIEW_MAX_CHARS).value,
            steps: run.steps.map((step) => ({
              stepIndex: step.stepIndex,
              stepId: step.stepId,
              status: step.status,
              waitKind: step.waitKind,
              outputPreview: truncateJson(step.output, PREVIEW_MAX_CHARS).value,
              errorPreview: truncateJson(step.error, PREVIEW_MAX_CHARS).value,
              attemptCount: attemptCounts.get(step.stepIndex) ?? 0,
            })),
          },
        },
        details: { targetTaskId: run.taskId, targetRunId: run.id },
      };
    }
    case "inbox": {
      const items = ctx.runtime
        .listInbox()
        .map((item) =>
          item.kind === "approval"
            ? { ...item, show: truncateJson(item.show, PREVIEW_MAX_CHARS).value }
            : { ...item, error: truncateJson(item.error, PREVIEW_MAX_CHARS).value },
        );
      return {
        payload: { view: "inbox", count: items.length, items },
        details: { summary: `${items.length} inbox items` },
      };
    }
    case "capabilities": {
      const snapshot = await ctx.channels.snapshot();
      const statusByAccount = new Map(snapshot.statuses.map((status) => [status.accountId, status]));
      const accounts = snapshot.accounts
        .filter((account) => account.enabled && account.configured)
        .map((account) => {
          const status = statusByAccount.get(account.id);
          const peers = new Map<string, { peerId: string; peerKind: "dm" | "group" | "unknown"; source: string }>();
          for (const binding of snapshot.bindings) {
            if (binding.accountId !== account.id) continue;
            peers.set(binding.peerId, { peerId: binding.peerId, peerKind: binding.peerKind, source: "binding" });
          }
          for (const peerId of account.allowFrom) {
            if (peerId && peerId !== "*" && !peers.has(peerId)) {
              peers.set(peerId, { peerId, peerKind: "dm", source: "allowFrom" });
            }
          }
          for (const groupId of account.groupIds) {
            if (groupId && groupId !== "*" && !peers.has(groupId)) {
              peers.set(groupId, { peerId: groupId, peerKind: "group", source: "groupIds" });
            }
          }
          return {
            accountId: account.id,
            channel: account.channel,
            name: account.name,
            connected: status?.connected ?? false,
            state: status?.state ?? "stopped",
            targets: [...peers.values()],
          };
        });
      return {
        payload: {
          view: "capabilities",
          cwd: sessionCwd,
          runtimeStatus: ctx.runtime.status(),
          activity: ctx.runtime.activity(),
          channels: accounts,
          secretPolicy:
            "Secret names are never enumerated here. Reference secrets by lowercase name matching /^[a-z0-9._-]{1,80}$/ and let the user configure values via the desktop card.",
        },
        details: { summary: `${accounts.length} channel accounts` },
      };
    }
  }
}
