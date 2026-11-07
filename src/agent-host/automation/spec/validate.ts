import { isAbsolute, relative, resolve } from "node:path";
import type { TaskSpec, ActionCall, JsonSchema, Cond, Text, EffectDecl } from "../../../shared/automation/spec";
import { assertValidSchemaDefinition } from "./json-schema";

export interface SpecIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}
export class SpecValidationError extends Error {
  constructor(readonly issues: readonly SpecIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  }
}
function requireSpec(ok: unknown, path: string, message: string): asserts ok {
  if (!ok) throw new SpecValidationError([{ path, code: "schema", message }]);
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown, path: string): asserts value is Text {
  requireSpec(
    typeof value === "string" || (record(value) && typeof value.$tmpl === "string" && Object.keys(value).length === 1),
    path,
    "Expected text or a text template",
  );
}
function literal(value: unknown, path: string): asserts value is string {
  requireSpec(
    typeof value === "string" && value.trim().length > 0 && !value.includes("{{"),
    path,
    "Expected a non-empty literal",
  );
}
function positive(value: unknown, path: string, min = 1): void {
  requireSpec(
    typeof value === "number" && Number.isSafeInteger(value) && value >= min,
    path,
    `Expected an integer >= ${min}`,
  );
}
export function parseDurationMs(duration: string): number {
  const match = /^(\d+(?:\.\d+)?)([smhd])$/.exec(duration);
  const units: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  const ms = match ? Number(match[1]) * units[match[2]] : NaN;
  if (!Number.isSafeInteger(ms) || ms < 0)
    throw new SpecValidationError([{ path: "duration", code: "duration", message: `Invalid duration: ${duration}` }]);
  return ms;
}
function duration(value: unknown, path: string, min = 1): void {
  requireSpec(typeof value === "string" && parseDurationMs(value) >= min, path, `Duration must be at least ${min}ms`);
}
function schema(value: unknown, path: string): void {
  requireSpec(record(value), path, "Expected JSON schema");
  try {
    assertValidSchemaDefinition(value as JsonSchema);
  } catch (error) {
    requireSpec(false, path, error instanceof Error ? error.message : String(error));
  }
}
function effect(value: unknown, path: string, required = false): void {
  if (value === undefined && !required) return;
  if (value === "read" || value === "unsafe") return;
  requireSpec(record(value) && record(value.idempotent), path, "Invalid effect declaration");
  if (value.idempotent.window !== "forever") duration(value.idempotent.window, `${path}.window`);
}
function target(value: unknown, path: string): void {
  requireSpec(record(value), path, "Expected static channel target");
  literal(value.accountId, `${path}.accountId`);
  literal(value.peerId, `${path}.peerId`);
}
function cond(value: unknown, path: string): asserts value is Cond<string> {
  requireSpec(record(value), path, "Expected condition");
  if ("all" in value || "any" in value) {
    const children = value.all ?? value.any;
    requireSpec(Array.isArray(children), path, "Expected conditions array");
    children.forEach((child, index) => {
      cond(child, `${path}.${index}`);
    });
  } else if ("not" in value) cond(value.not, path);
  else {
    requireSpec(
      typeof value.ref === "string" &&
        ["eq", "ne", "gt", "gte", "lt", "lte", "in", "contains", "exists"].includes(String(value.op)),
      path,
      "Invalid comparison",
    );
  }
}
function refs(value: unknown, earlier: readonly string[], roots: readonly string[], path: string): void {
  const check = (ref: string) => {
    const valid = ref.startsWith("steps.")
      ? earlier.some((id) => ref === `steps.${id}.output` || ref.startsWith(`steps.${id}.output.`))
      : roots.some((root) => ref === root || (root !== "run.id" && root !== "task.name" && ref.startsWith(`${root}.`)));
    requireSpec(valid, path, `Unknown or forward reference: ${ref}`);
  };
  if (Array.isArray(value))
    value.forEach((child) => {
      refs(child, earlier, roots, path);
    });
  else if (record(value)) {
    if (typeof value.$ref === "string") check(value.$ref);
    else if (typeof value.$tmpl === "string")
      for (const match of value.$tmpl.matchAll(/\{\{([^}]+)\}\}/g)) check(match[1].trim());
    else
      for (const [key, child] of Object.entries(value)) {
        if (key === "ref" && typeof child === "string") check(child);
        else refs(child, earlier, roots, path);
      }
  }
}
function validateCall(value: unknown, cwd: string, path: string, probe = false): asserts value is ActionCall {
  requireSpec(record(value) && record(value.with), path, "Expected action call");
  const options = value.with;
  if (options.timeout !== undefined) duration(options.timeout, `${path}.timeout`);
  effect(options.effect, path, value.action === "script.run");
  if (value.action === "http.request") {
    requireSpec(record(options.url), path, "Expected HTTP URL");
    literal(options.url.origin, path);
    let url: URL;
    try {
      url = new URL(options.url.origin);
    } catch {
      requireSpec(false, path, "Invalid HTTP origin");
    }
    requireSpec(
      ["http:", "https:"].includes(url.protocol) && url.origin === options.url.origin && !url.username && !url.password,
      path,
      "Expected a static HTTP origin without credentials or path",
    );
    requireSpec(
      options.method === undefined ||
        ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(String(options.method)),
      path,
      "Invalid HTTP method",
    );
    if (probe)
      requireSpec(
        (options.method === undefined || ["GET", "HEAD"].includes(String(options.method))) &&
          (options.effect === undefined || options.effect === "read"),
        path,
        "Probe must be read-only",
      );
    if (options.url.path !== undefined) text(options.url.path, path);
    for (const values of [options.url.query, options.headers])
      if (values !== undefined) {
        requireSpec(record(values), path, "Expected text map");
        Object.values(values).forEach((value) => {
          text(value, path);
        });
      }
    if (options.expectStatus !== undefined)
      requireSpec(
        Array.isArray(options.expectStatus) &&
          options.expectStatus.length > 0 &&
          options.expectStatus.every(
            (status) => Number.isInteger(status) && Number(status) >= 100 && Number(status) <= 599,
          ),
        path,
        "Invalid HTTP status list",
      );
    if (options.secretHeaders !== undefined) {
      requireSpec(record(options.secretHeaders), path, "Expected secret map");
      Object.values(options.secretHeaders).forEach((name) => {
        requireSpec(typeof name === "string" && /^[a-z0-9._-]{1,80}$/.test(name), path, "Invalid secret name");
      });
    }
  } else if (value.action === "channel.send") {
    requireSpec(!probe, path, "Probe cannot send messages");
    target(options.to, path);
    text(options.text, path);
    requireSpec(
      options.format === undefined || ["text", "markdown"].includes(String(options.format)),
      path,
      "Invalid message format",
    );
  } else if (value.action === "script.run") {
    literal(options.path, path);
    const rel = relative(resolve(cwd), resolve(cwd, options.path));
    requireSpec(
      !isAbsolute(options.path) &&
        rel !== ".." &&
        !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
        !isAbsolute(rel),
      path,
      "Script must be inside cwd",
    );
    if (probe) requireSpec(options.effect === "read", path, "Probe must be read-only");
    if (options.secrets !== undefined)
      requireSpec(
        Array.isArray(options.secrets) &&
          options.secrets.every((name) => typeof name === "string" && /^[a-z0-9._-]{1,80}$/.test(name)),
        path,
        "Invalid secret names",
      );
  } else requireSpec(false, path, "Unknown action");
}

export function assertTaskSpec(input: unknown): asserts input is TaskSpec {
  requireSpec(record(input), "$", "Expected task object");
  requireSpec(input.schema === "dexon.automation/v1", "schema", "Unsupported task schema");
  literal(input.id, "id");
  literal(input.name, "name");
  literal(input.cwd, "cwd");
  requireSpec(isAbsolute(input.cwd), "cwd", "Expected absolute cwd");
  requireSpec(Array.isArray(input.triggers) && input.triggers.length > 0, "triggers", "Expected triggers");
  requireSpec(Array.isArray(input.steps) && input.steps.length > 0, "steps", "Expected steps");
  if (input.inputSchema !== undefined) schema(input.inputSchema, "inputSchema");
  const ids: string[] = [];
  for (const [index, step] of input.steps.entries()) {
    const path = `steps.${index}`;
    requireSpec(record(step), path, "Expected step");
    literal(step.id, path);
    requireSpec(!ids.includes(step.id), path, "Duplicate step ID");
    for (const key of ["when", "stopRunIf"]) if (step[key] !== undefined) cond(step[key], `${path}.${key}`);
    if (step.timeout !== undefined) duration(step.timeout, path);
    requireSpec(
      step.onFailure === undefined || ["fail_run", "continue"].includes(String(step.onFailure)),
      path,
      "Invalid onFailure",
    );
    requireSpec(
      step.onUnknown === undefined || ["attention", "continue"].includes(String(step.onUnknown)),
      path,
      "Invalid onUnknown",
    );
    if (step.retry !== undefined) {
      requireSpec(record(step.retry) && step.kind !== "wait", path, "Invalid retry");
      positive(step.retry.maxAttempts, path);
      duration(step.retry.backoff, path);
      requireSpec(
        step.retry.factor === undefined ||
          (typeof step.retry.factor === "number" && Number.isFinite(step.retry.factor) && step.retry.factor >= 1),
        path,
        "Invalid retry factor",
      );
    }
    const values: unknown[] = [step.when];
    refs(step.stopRunIf, [...ids, step.id], ["input", "trigger", "run.id", "task.name"], path);
    if (step.kind === "agent") {
      text(step.prompt, path);
      requireSpec(
        Array.isArray(step.tools) &&
          step.tools.every((tool) => ["read", "write", "edit", "bash", "grep", "find"].includes(String(tool))),
        path,
        "Invalid tool allowlist",
      );
      effect(step.effect, path);
      requireSpec(record(step.output), path, "Expected output contract");
      schema(step.output.schema, path);
      if (step.model !== undefined) {
        requireSpec(record(step.model), path, "Invalid model");
        literal(step.model.provider, path);
        literal(step.model.modelId, path);
      }
      requireSpec(
        step.thinkingLevel === undefined ||
          ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(String(step.thinkingLevel)),
        path,
        "Invalid thinking level",
      );
      values.push(step.prompt, step.data);
    } else if (step.kind === "action") {
      validateCall(step.call, input.cwd, path);
      values.push(step.call);
    } else if (step.kind === "wait") {
      requireSpec(record(step.wait), path, "Expected wait");
      if (step.expiresIn !== undefined) duration(step.expiresIn, path);
      requireSpec(
        step.onTimeout === undefined || ["fail", "continue"].includes(String(step.onTimeout)),
        path,
        "Invalid onTimeout",
      );
      const wait = step.wait;
      if (wait.kind === "approval") {
        text(wait.title, path);
        if (wait.prompt !== undefined) text(wait.prompt, path);
        if (wait.fields !== undefined) {
          schema(wait.fields, path);
          requireSpec((wait.fields as JsonSchema).type === "object", path, "Approval fields must be an object schema");
        }
        if (wait.notify !== undefined) {
          requireSpec(record(wait.notify), path, "Invalid notification");
          target(wait.notify.to, path);
          if (wait.notify.text !== undefined) text(wait.notify.text, path);
        }
        values.push(wait.title, wait.prompt, wait.show, wait.defaults, wait.notify);
      } else if (wait.kind === "signal") {
        literal(wait.signal, path);
        text(wait.key, path);
        requireSpec(
          wait.history === undefined || ["run-start", "retained"].includes(String(wait.history)),
          path,
          "Invalid signal history",
        );
        values.push(wait.key);
      } else {
        requireSpec(wait.kind === "duration", path, "Invalid wait kind");
        duration(wait.duration, path, 0);
      }
    } else requireSpec(false, path, "Unknown step kind");
    values.forEach((value) => {
      refs(value, ids, ["input", "trigger", "run.id", "task.name"], path);
    });
    ids.push(step.id);
  }
  const triggerIds = new Set<string>();
  for (const trigger of input.triggers) {
    requireSpec(record(trigger), "triggers", "Expected trigger");
    literal(trigger.id, "triggers");
    requireSpec(!triggerIds.has(trigger.id), "triggers", "Duplicate trigger ID");
    triggerIds.add(trigger.id);
    if (trigger.kind === "manual") continue;
    if (trigger.kind === "schedule") {
      requireSpec(
        (trigger.every !== undefined) !== (trigger.cron !== undefined),
        "triggers",
        "Expected exactly one schedule calendar",
      );
      if (trigger.every !== undefined) duration(trigger.every, "triggers");
      else {
        literal(trigger.cron, "triggers");
        requireSpec(trigger.tz === undefined || typeof trigger.tz === "string", "triggers", "Invalid timezone");
      }
      if (trigger.catchupWindow !== undefined) duration(trigger.catchupWindow, "triggers");
      requireSpec(
        trigger.catchup === undefined || ["skip", "once"].includes(String(trigger.catchup)),
        "triggers",
        "Invalid catchup",
      );
      refs(trigger.input, [], [], "triggers.input");
    } else {
      requireSpec(trigger.kind === "watch", "triggers", "Unknown trigger");
      duration(trigger.every, "triggers", 30000);
      validateCall(trigger.probe, input.cwd, "triggers.probe", true);
      requireSpec(record(trigger.mode), "triggers.mode", "Expected watch mode");
      const mode = trigger.mode;
      if (trigger.staleResetGap !== undefined) duration(trigger.staleResetGap, "triggers");
      if (mode.type === "threshold") {
        cond(mode.healthy, "triggers.mode");
        refs(mode.healthy, [], ["probe.ok", "probe.output"], "triggers.mode");
        positive(mode.consecutive, "triggers.mode");
        if (mode.cooldown !== undefined) duration(mode.cooldown, "triggers.mode", 0);
        if (mode.staleResetGap !== undefined) duration(mode.staleResetGap, "triggers.mode");
      } else {
        requireSpec(mode.type === "items", "triggers.mode", "Invalid watch mode");
        requireSpec(
          typeof mode.itemsPath === "string" && typeof mode.keyPath === "string",
          "triggers.mode",
          "Expected item paths",
        );
        if (mode.cursorPath !== undefined)
          requireSpec(typeof mode.cursorPath === "string", "triggers.mode", "Invalid cursor path");
        if (mode.match !== undefined) cond(mode.match, "triggers.mode");
        if (mode.dedupeWindow !== undefined) duration(mode.dedupeWindow, "triggers.mode");
        requireSpec(
          record(mode.emit) && record(mode.emit.startRun) !== (typeof mode.emit.emitSignal === "string"),
          "triggers.mode",
          "Expected one item emission",
        );
        refs([mode.match, mode.emit], [], ["item"], "triggers.mode");
      }
      refs(trigger.probe, [], [], "triggers.probe");
    }
  }
  if (input.concurrency !== undefined) {
    requireSpec(record(input.concurrency), "concurrency", "Expected concurrency");
    if (input.concurrency.maxExecuting !== undefined) positive(input.concurrency.maxExecuting, "concurrency");
    if (input.concurrency.lane !== undefined) {
      const lane = input.concurrency.lane;
      requireSpec(record(lane), "concurrency.lane", "Expected lane");
      positive(lane.capacity, "concurrency.lane");
      requireSpec(["skip", "queue", "latest"].includes(String(lane.overflow)), "concurrency.lane", "Invalid overflow");
      if (lane.maxPending !== undefined) positive(lane.maxPending, "concurrency.lane", 0);
      if (lane.key !== undefined) {
        text(lane.key, "concurrency.lane");
        refs(lane.key, [], ["input", "trigger", "run.id", "task.name"], "concurrency.lane");
      }
    }
  }
}

export function normalizeEffect(value: EffectDecl | undefined, fallback: "read" | "unsafe") {
  if (value === "read" || value === "unsafe" || value === undefined) return { kind: value ?? fallback };
  return {
    kind: "idempotent" as const,
    windowMs: value.idempotent.window === "forever" ? null : parseDurationMs(value.idempotent.window),
  };
}
