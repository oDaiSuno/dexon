import type { EnvironmentId } from "./environment";
import type { Json, SecretName } from "../shared/automation/spec";
import { isAutomationSecretName, isAutomationSecretValue } from "../shared/automation/secret-name.ts";
import { ATTENTION_ACTIONS } from "../shared/automation/views.ts";
import type { AttentionResolveRequest, ResolveInboxResult, TaskView } from "../shared/automation/views";

export type AutomationCommand =
  | {
      readonly type: "enable-task";
      readonly environmentId: EnvironmentId;
      readonly taskId: string;
      readonly revision: number;
      readonly planHash: string;
    }
  | {
      readonly type: "resolve-attention";
      readonly environmentId: EnvironmentId;
      readonly request: AttentionResolveRequest;
    }
  | {
      readonly type: "set-secret";
      readonly environmentId: EnvironmentId;
      readonly name: SecretName;
      readonly value: string;
    }
  | { readonly type: "delete-secret"; readonly environmentId: EnvironmentId; readonly name: SecretName }
  | { readonly type: "list-secret-names"; readonly environmentId: EnvironmentId };

export interface AutomationCommandResults {
  "enable-task": { readonly outcome: "enabled"; readonly task: TaskView } | { readonly outcome: "cancelled" };
  "resolve-attention":
    { readonly outcome: "resolved"; readonly result: ResolveInboxResult } | { readonly outcome: "cancelled" };
  "set-secret": { readonly ok: true };
  "delete-secret": { readonly ok: true };
  "list-secret-names": { readonly names: readonly string[] };
}

export type AutomationCommandResult<C extends AutomationCommand> = AutomationCommandResults[C["type"]];

function invalid(field: string): never {
  throw new Error(`Invalid automation command: ${field}`);
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(field);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid(field);
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 256 || /[\0\r\n]/.test(value)) invalid(field);
  return value;
}

function integer(value: unknown, field: string, min: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min) invalid(field);
  return value;
}

function json(value: unknown, ancestors = new Set<object>()): Json {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || !value || ancestors.has(value)) invalid("request.resolution.output");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return Array.from(value, (entry) => json(entry, ancestors));
    return Object.fromEntries(
      Object.entries(object(value, "request.resolution.output")).map(([key, entry]) => [key, json(entry, ancestors)]),
    );
  } finally {
    ancestors.delete(value);
  }
}

function attentionRequest(value: unknown): AttentionResolveRequest {
  const request = object(value, "request");
  const resolution = object(request.resolution, "request.resolution");
  const action = ATTENTION_ACTIONS.find((candidate) => candidate === resolution.action);
  if (resolution.kind !== "attention" || !action) invalid("request.resolution");
  return {
    runId: text(request.runId, "request.runId"),
    stepIndex: integer(request.stepIndex, "request.stepIndex", 0),
    expectedVersion: integer(request.expectedVersion, "request.expectedVersion", 1),
    requestId: text(request.requestId, "request.requestId"),
    ...(request.requestDigest === undefined
      ? {}
      : { requestDigest: text(request.requestDigest, "request.requestDigest") }),
    resolution: {
      kind: "attention",
      action,
      ...(resolution.output === undefined ? {} : { output: json(resolution.output) }),
    },
  };
}

export function parseAutomationCommand(value: unknown): AutomationCommand {
  const command = object(value, "command");
  const environmentId = text(command.environmentId, "environmentId");
  switch (command.type) {
    case "enable-task": {
      const taskId = text(command.taskId, "taskId");
      const revision = integer(command.revision, "revision", 1);
      const planHash = command.planHash;
      if (typeof planHash !== "string" || planHash.length !== 64 || !/^[a-f0-9]{64}$/i.test(planHash))
        invalid("planHash");
      return { type: "enable-task", environmentId, taskId, revision, planHash };
    }
    case "resolve-attention":
      return { type: "resolve-attention", environmentId, request: attentionRequest(command.request) };
    case "set-secret": {
      if (!isAutomationSecretName(command.name)) invalid("name");
      if (!isAutomationSecretValue(command.value)) invalid("value");
      return { type: "set-secret", environmentId, name: command.name, value: command.value };
    }
    case "delete-secret": {
      if (!isAutomationSecretName(command.name)) invalid("name");
      return { type: "delete-secret", environmentId, name: command.name };
    }
    case "list-secret-names":
      return { type: "list-secret-names", environmentId };
    default:
      return invalid("type");
  }
}
