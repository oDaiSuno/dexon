import type { TaskSpec, StepSpec, ActionCall, Json, EffectDecl } from "../../../shared/automation/spec";
import {
  TaskId,
  StepId,
  TriggerId,
  type TaskPlan,
  type StepPlan,
  type TriggerPlan,
  type ActionCallPlan,
  type EffectPolicy,
} from "../core/plan";
import { assertTaskSpec, parseDurationMs, normalizeEffect, SpecValidationError } from "./validate";
import { createCalendar } from "../core/calendar";
export { parseDurationMs, SpecValidationError } from "./validate";

export interface NormalizeOptions {
  readonly scriptHashes?: Readonly<Record<string, string>>;
}
const json = (value: unknown): Json => (value === undefined ? null : (structuredClone(value) as Json));
const policy = (effect: EffectDecl | undefined, fallback: "read" | "unsafe"): EffectPolicy =>
  normalizeEffect(effect, fallback);

function normalizeCall(call: ActionCall, opts: NormalizeOptions): ActionCallPlan {
  if (call.action === "http.request") {
    const request = call.with;
    const method = request.method ?? "GET";
    return {
      action: call.action,
      method,
      origin: request.url.origin,
      pathTmpl: request.url.path ?? null,
      queryTmpl: request.url.query ?? null,
      headersTmpl: request.headers ?? null,
      secretHeaders: request.secretHeaders ?? null,
      bodyTmpl: json(request.body),
      expectStatus: request.expectStatus ?? [200],
      timeoutMs: request.timeout ? parseDurationMs(request.timeout) : 30000,
      effect: policy(request.effect, ["GET", "HEAD"].includes(method) ? "read" : "unsafe"),
    };
  }
  if (call.action === "channel.send")
    return {
      action: call.action,
      to: call.with.to,
      textTmpl: call.with.text,
      format: call.with.format ?? "text",
      attachmentsTmpl: json(call.with.attachments),
    };
  return {
    action: call.action,
    path: call.with.path,
    sha256: opts.scriptHashes?.[call.with.path] ?? "",
    argsTmpl: json(call.with.args),
    effect: policy(call.with.effect, "unsafe"),
    secrets: call.with.secrets ?? [],
    timeoutMs: call.with.timeout ? parseDurationMs(call.with.timeout) : 300000,
  };
}

function normalizeStep(
  spec: StepSpec,
  index: number,
  opts: NormalizeOptions,
  generatedFrom: StepPlan["generatedFrom"],
): StepPlan {
  const base = {
    stepIndex: index,
    id: StepId(spec.id),
    title: spec.title ?? null,
    whenCond: spec.when ?? null,
    stopRunIfCond: spec.stopRunIf ?? null,
    timeoutMs: spec.timeout ? parseDurationMs(spec.timeout) : null,
    onFailure: spec.onFailure ?? "fail_run",
    generatedFrom,
  } as const;
  if (spec.kind === "wait") {
    const wait = spec.wait;
    const normalized =
      wait.kind === "approval"
        ? {
            kind: "approval" as const,
            titleTmpl: wait.title,
            promptTmpl: wait.prompt ?? null,
            showTmpl: json(wait.show),
            fieldsSchema: wait.fields ?? null,
            defaultsTmpl: json(wait.defaults),
          }
        : wait.kind === "signal"
          ? { kind: "signal" as const, signal: wait.signal, keyTmpl: wait.key, history: wait.history ?? "run-start" }
          : { kind: "duration" as const, durationMs: parseDurationMs(wait.duration) };
    return {
      ...base,
      kind: "wait",
      wait: normalized,
      expiresInMs: spec.expiresIn ? parseDurationMs(spec.expiresIn) : null,
      onTimeout: spec.onTimeout ?? "fail",
    };
  }
  const retry = {
    maxAttempts: spec.retry?.maxAttempts ?? (spec.kind === "agent" ? 1 : 3),
    backoffMs: spec.retry ? parseDurationMs(spec.retry.backoff) : 5000,
    backoffFactor: spec.retry?.factor ?? 2,
    onUnknown: spec.onUnknown ?? "attention",
  } as const;
  if (spec.kind === "action") return { ...base, ...retry, kind: "action", call: normalizeCall(spec.call, opts) };
  return {
    ...base,
    ...retry,
    kind: "agent",
    prompt: spec.prompt,
    data: json(spec.data),
    tools: [...new Set(spec.tools)],
    effect: policy(
      spec.effect,
      spec.tools.some((tool) => ["write", "edit", "bash"].includes(tool)) ? "unsafe" : "read",
    ),
    model: spec.model ?? null,
    thinkingLevel: spec.thinkingLevel ?? null,
    outputSchema: spec.output.schema,
  };
}

export function normalizeTaskSpec(input: unknown, opts: NormalizeOptions = {}): TaskPlan {
  assertTaskSpec(input);
  const spec: TaskSpec = structuredClone(input);
  const steps: StepPlan[] = [];
  const ids = new Set(spec.steps.map((step) => step.id));
  for (const step of spec.steps) {
    if (step.kind === "wait" && step.wait.kind === "approval" && step.wait.notify) {
      const id = `${step.id}.notify`;
      if (ids.has(id))
        throw new SpecValidationError([
          { path: "steps", code: "duplicate_id", message: `Generated step ID conflicts: ${id}` },
        ]);
      ids.add(id);
      steps.push(
        normalizeStep(
          {
            kind: "action",
            id,
            when: step.when,
            call: {
              action: "channel.send",
              with: { to: step.wait.notify.to, text: step.wait.notify.text ?? step.wait.title },
            },
            retry: { maxAttempts: 1, backoff: "1s" },
            onFailure: "continue",
            onUnknown: "continue",
          },
          steps.length,
          opts,
          { kind: "approval_notify", waitStepId: step.id },
        ),
      );
    }
    steps.push(normalizeStep(step, steps.length, opts, null));
  }
  const triggers: TriggerPlan[] = spec.triggers.map((trigger): TriggerPlan => {
    const id = TriggerId(trigger.id);
    if (trigger.kind === "manual") return { id, kind: "manual" };
    if (trigger.kind === "schedule") {
      const plan = {
        id,
        kind: "schedule" as const,
        calendar:
          "every" in trigger
            ? { everyMs: parseDurationMs(trigger.every) }
            : { cron: trigger.cron, tz: trigger.tz ?? "UTC" },
        catchup: trigger.catchup ?? "skip",
        catchupWindowMs: trigger.catchupWindow ? parseDurationMs(trigger.catchupWindow) : 3600000,
        misfireGraceMs: 15000,
        input: json(trigger.input),
      };
      createCalendar(plan.calendar, 0);
      return plan;
    }
    const probe = normalizeCall(trigger.probe, opts);
    if (probe.action === "channel.send") throw new Error("Read-only probe required");
    const mode = trigger.mode;
    return {
      id,
      kind: "watch",
      everyMs: parseDurationMs(trigger.every),
      probe,
      staleResetGapMs: trigger.staleResetGap
        ? parseDurationMs(trigger.staleResetGap)
        : mode.type === "threshold" && mode.staleResetGap
          ? parseDurationMs(mode.staleResetGap)
          : null,
      mode:
        mode.type === "threshold"
          ? {
              type: "threshold",
              healthy: mode.healthy,
              consecutive: mode.consecutive,
              cooldownMs: mode.cooldown ? parseDurationMs(mode.cooldown) : 0,
            }
          : {
              type: "items",
              itemsPath: mode.itemsPath,
              keyPath: mode.keyPath,
              cursorPath: mode.cursorPath ?? null,
              dedupeWindowMs: mode.dedupeWindow ? parseDurationMs(mode.dedupeWindow) : null,
              match: mode.match ?? null,
              emit:
                "startRun" in mode.emit
                  ? { kind: "start", input: json(mode.emit.startRun.input) }
                  : { kind: "signal", name: mode.emit.emitSignal, payload: json(mode.emit.payload) },
            },
    };
  });
  return {
    version: 1,
    id: TaskId(spec.id),
    name: spec.name,
    cwd: spec.cwd,
    inputSchema: spec.inputSchema ?? null,
    triggers,
    steps,
    lane: spec.concurrency?.lane
      ? {
          keyTmpl: spec.concurrency.lane.key ?? null,
          capacity: spec.concurrency.lane.capacity,
          overflow: spec.concurrency.lane.overflow,
          maxPending: spec.concurrency.lane.maxPending ?? 100,
        }
      : null,
    maxExecuting: spec.concurrency?.maxExecuting ?? 1,
  };
}
