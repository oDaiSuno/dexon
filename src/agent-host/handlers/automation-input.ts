import { RpcError } from "../../contract/types";
import { RUN_PHASES } from "../../shared/automation/phases";
import type { Json } from "../../shared/automation/spec";
import {
  ATTENTION_ACTIONS,
  type ApprovalResolveRequest,
  type AttentionAction,
  type AttentionResolveRequest,
} from "../../shared/automation/views";

export function invalid(message = "Invalid automation request"): never {
  throw new RpcError({ code: "BAD_REQUEST", message });
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
export function text(value: unknown, max = 256): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\0\r\n]/.test(value)) invalid();
  return value;
}
export function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) invalid();
  return value;
}
export function json(value: unknown): Json {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(json);
  return Object.fromEntries(Object.entries(object(value)).map(([key, entry]) => [key, json(entry)]));
}
export function queryRuns(value: unknown) {
  const body = value === undefined ? {} : object(value);
  return {
    ...(body.taskId === undefined ? {} : { taskId: text(body.taskId) }),
    ...(body.limit === undefined ? {} : { limit: integer(body.limit, 1, 10000) }),
    ...(body.beforeMs === undefined ? {} : { beforeMs: integer(body.beforeMs) }),
    ...(body.phases === undefined
      ? {}
      : {
          phases: (() => {
            if (!Array.isArray(body.phases) || body.phases.some((phase) => !RUN_PHASES.includes(phase))) invalid();
            return body.phases as (typeof RUN_PHASES)[number][];
          })(),
        }),
  };
}
function resolveRequestBase(value: unknown) {
  const body = object(value);
  return {
    runId: text(body.runId),
    stepIndex: integer(body.stepIndex),
    expectedVersion: integer(body.expectedVersion, 1),
    requestId: text(body.requestId),
    resolution: object(body.resolution),
  };
}
export function approvalResolveRequest(value: unknown): ApprovalResolveRequest {
  const { resolution, ...base } = resolveRequestBase(value);
  if (resolution.kind !== "approval" || typeof resolution.approved !== "boolean") invalid();
  return {
    ...base,
    resolution: {
      kind: "approval",
      approved: resolution.approved,
      ...(resolution.data === undefined ? {} : { data: json(resolution.data) }),
    },
  };
}
export function attentionResolveRequest(value: unknown): AttentionResolveRequest {
  const { resolution, ...base } = resolveRequestBase(value);
  if (resolution.kind !== "attention" || !ATTENTION_ACTIONS.some((action) => action === resolution.action)) invalid();
  return {
    ...base,
    resolution: {
      kind: "attention",
      action: resolution.action as AttentionAction,
      ...(resolution.output === undefined ? {} : { output: json(resolution.output) }),
    },
  };
}
