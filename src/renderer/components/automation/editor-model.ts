import type { StepSpec, TaskSpec, TriggerSpec } from "@shared/automation/spec";

export type EditorStepKind = "agent" | "approval" | "http" | "script" | "channel" | "signal" | "duration";
export const editorStepKinds: readonly EditorStepKind[] = [
  "agent",
  "approval",
  "http",
  "script",
  "channel",
  "signal",
  "duration",
];

export function editorStepKind(step: StepSpec): EditorStepKind {
  if (step.kind === "agent") return "agent";
  if (step.kind === "wait") return step.wait.kind;
  if (step.call.action === "http.request") return "http";
  return step.call.action === "script.run" ? "script" : "channel";
}

export function editorNewStep(kind: EditorStepKind, id: string): StepSpec {
  if (kind === "agent")
    return { id, kind: "agent", prompt: "", tools: ["read", "grep", "find"], output: { schema: { type: "object" } } };
  if (kind === "approval") return { id, kind: "wait", wait: { kind: "approval", title: "" } };
  if (kind === "signal")
    return { id, kind: "wait", wait: { kind: "signal", signal: "ready", key: { $tmpl: "{{run.id}}" } } };
  if (kind === "duration") return { id, kind: "wait", wait: { kind: "duration", duration: "1m" } };
  if (kind === "http")
    return {
      id,
      kind: "action",
      call: { action: "http.request", with: { method: "GET", url: { origin: "https://example.com", path: "/" } } },
    };
  if (kind === "script")
    return { id, kind: "action", call: { action: "script.run", with: { path: "scripts/task.sh", effect: "read" } } };
  return {
    id,
    kind: "action",
    call: { action: "channel.send", with: { to: { accountId: "", peerId: "" }, text: "" } },
  };
}

export function editorNewTrigger(kind: TriggerSpec["kind"], id: string): TriggerSpec {
  if (kind === "manual") return { id, kind };
  if (kind === "schedule")
    return {
      id,
      kind,
      cron: "0 9 * * *",
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      catchup: "skip",
    };
  return {
    id,
    kind,
    every: "1m",
    probe: { action: "http.request", with: { method: "GET", url: { origin: "https://example.com" } } },
    mode: { type: "threshold", healthy: { ref: "probe.ok", op: "eq", value: true }, consecutive: 1 },
  };
}

export function editorUniqueId(prefix: string, entries: readonly { readonly id: string }[]): string {
  let index = 1;
  while (entries.some((entry) => entry.id === `${prefix}-${index}`)) index++;
  return `${prefix}-${index}`;
}

export function editorTaskDirectory(root: string, id: string): string {
  const separator = root.includes("\\") ? "\\" : "/";
  return `${root.replace(/[\\/]$/, "")}${separator}${id.replace(/[^a-zA-Z0-9_-]/g, "-") || "task"}`;
}

export function editorNewTask(name: string, cwd = ""): TaskSpec {
  return {
    schema: "dexon.automation/v1",
    id: `task-${Date.now().toString(36)}`,
    name,
    cwd,
    triggers: [{ id: "manual", kind: "manual" }],
    steps: [editorNewStep("agent", "step-1")],
  };
}

export function editorRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function editorSecrets(step: StepSpec): readonly string[] {
  if (step.kind !== "action") return [];
  if (step.call.action === "http.request") return Object.values(step.call.with.secretHeaders ?? {});
  return step.call.action === "script.run" ? (step.call.with.secrets ?? []) : [];
}

export function editorTriggerSecrets(trigger: TriggerSpec): readonly string[] {
  if (trigger.kind !== "watch") return [];
  return trigger.probe.action === "http.request"
    ? Object.values(trigger.probe.with.secretHeaders ?? {})
    : (trigger.probe.with.secrets ?? []);
}

export function editorAllSecrets(spec: TaskSpec): readonly string[] {
  return [...new Set([...spec.steps.flatMap(editorSecrets), ...spec.triggers.flatMap(editorTriggerSecrets)])];
}

export function editorError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function editorJson(value: unknown): string {
  return value === undefined ? "" : JSON.stringify(value, null, 2);
}
