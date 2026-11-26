import type { Json, SignalWaitSpec, Text } from "@shared/automation/spec";
import type { AttemptView, RunDetailView, StepView } from "@shared/automation/views";

function readPath(value: Json | undefined, path: string): Json | undefined {
  if (!path) return value;
  for (const part of path.split(".")) {
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, part)) return undefined;
    value = (value as Record<string, Json>)[part];
  }
  return value;
}

function lookupRunValue(path: string, run: RunDetailView, taskName: string): Json | undefined {
  if (path.startsWith("steps.")) {
    const step = [...run.steps]
      .filter((entry) => entry.status === "done")
      .sort((a, b) => b.stepId.length - a.stepId.length)
      .find((entry) => path === `steps.${entry.stepId}.output` || path.startsWith(`steps.${entry.stepId}.output.`));
    if (!step) return undefined;
    return readPath(step.output, path.slice(`steps.${step.stepId}.output`.length + 1));
  }
  const [root, ...parts] = path.split(".");
  const roots: Record<string, Json> = {
    input: run.input,
    trigger: run.triggerFact,
    run: { id: run.id },
    task: { name: taskName },
  };
  return readPath(roots[root], parts.join("."));
}

export function renderRunText(text: Text, run: RunDetailView, taskName: string): string | null {
  if (typeof text === "string") return text;
  let missing = false;
  const rendered = text.$tmpl.replace(/\{\{([^}]+)\}\}/g, (_, rawPath: string) => {
    const value = lookupRunValue(rawPath.trim(), run, taskName);
    if (value === undefined) {
      missing = true;
      return "";
    }
    return typeof value === "string" ? value : JSON.stringify(value);
  });
  return missing ? null : rendered;
}

export function signalWaitTarget(
  wait: SignalWaitSpec,
  record: StepView,
  run: RunDetailView,
  taskName: string,
): { readonly name: string; readonly key: string | null } {
  const fact = record as StepView & { readonly signalName?: unknown; readonly signalKey?: unknown };
  return {
    name: typeof fact.signalName === "string" ? fact.signalName : wait.signal,
    key: typeof fact.signalKey === "string" ? fact.signalKey : renderRunText(wait.key, run, taskName),
  };
}

export function attemptOutput(attempt: AttemptView): Json | undefined {
  const detail = attempt.detail;
  if (attempt.outcome !== "committed" || detail === null || typeof detail !== "object" || Array.isArray(detail))
    return undefined;
  return Object.hasOwn(detail, "output") ? detail.output : undefined;
}

export function outputPreview(value: Json): readonly { readonly key: string; readonly value: string }[] {
  const entries =
    value !== null && typeof value === "object"
      ? Object.entries(value).filter(([, item]) => item === null || typeof item !== "object")
      : [["", value] as const];
  return entries.slice(0, 6).map(([key, item]) => ({
    key,
    value: typeof item === "string" ? item : JSON.stringify(item),
  }));
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
