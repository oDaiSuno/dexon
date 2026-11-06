import { isDeepStrictEqual } from "node:util";
import type { Json, Value, Cond, CompareOp, Text } from "../../../shared/automation/spec";

export interface ResolveContext {
  readonly input: Json;
  readonly trigger: Json;
  readonly run: { readonly id: string };
  readonly task?: { readonly name: string };
  readonly steps: ReadonlyMap<string, { readonly output: Json }>;
  readonly probe?: { readonly ok: boolean; readonly output: Json };
  readonly item?: Json;
}

export class ResolveError extends Error {
  readonly code = "invalid_input";
  constructor(readonly path: string) {
    super(`Missing value at ${path}`);
  }
}

export function readPath(value: Json | undefined, path: string): Json | undefined {
  if (!path) return value;
  for (const part of path.split(".")) {
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, part)) return undefined;
    value = (value as Record<string, Json>)[part];
  }
  return value;
}

function lookup(path: string, context: ResolveContext): Json | undefined {
  if (path.startsWith("steps.")) {
    const id = [...context.steps.keys()]
      .sort((a, b) => b.length - a.length)
      .find((key) => path === `steps.${key}.output` || path.startsWith(`steps.${key}.output.`));
    if (id === undefined) return undefined;
    return readPath(context.steps.get(id)?.output, path.slice(`steps.${id}.output`.length + 1));
  }
  const [root, ...parts] = path.split(".");
  const roots: Record<string, Json | undefined> = {
    input: context.input,
    trigger: context.trigger,
    run: { id: context.run.id },
    task: context.task ? { name: context.task.name } : undefined,
    probe: context.probe ? { ...context.probe } : undefined,
    item: context.item,
  };
  return readPath(roots[root], parts.join("."));
}

export function resolveValue<P extends string>(value: Value<P>, context: ResolveContext): Json {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((entry) => resolveValue(entry, context));
  if ("$ref" in value && typeof value.$ref === "string") {
    const resolved = lookup(value.$ref, context);
    if (resolved === undefined) throw new ResolveError(value.$ref);
    return resolved;
  }
  if ("$tmpl" in value && typeof value.$tmpl === "string") return renderText({ $tmpl: value.$tmpl }, context);
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, resolveValue(entry as Value<P>, context)]),
  );
}

export function renderText(text: Text, context: ResolveContext): string {
  if (typeof text === "string") return text;
  return text.$tmpl.replace(/\{\{([^}]+)\}\}/g, (_, rawPath: string) => {
    const path = rawPath.trim();
    const value = lookup(path, context);
    if (value === undefined) throw new ResolveError(path);
    return typeof value === "string" ? value : JSON.stringify(value);
  });
}

function compare(left: Json, op: CompareOp, right: Json): boolean {
  switch (op) {
    case "eq":
      return isDeepStrictEqual(left, right);
    case "ne":
      return !isDeepStrictEqual(left, right);
    case "gt":
      return typeof left === "number" && typeof right === "number" && left > right;
    case "gte":
      return typeof left === "number" && typeof right === "number" && left >= right;
    case "lt":
      return typeof left === "number" && typeof right === "number" && left < right;
    case "lte":
      return typeof left === "number" && typeof right === "number" && left <= right;
    case "in":
      return Array.isArray(right) && right.some((value) => isDeepStrictEqual(left, value));
    case "contains":
      return Array.isArray(left)
        ? left.some((value) => isDeepStrictEqual(value, right))
        : typeof left === "string" && typeof right === "string" && left.includes(right);
    case "exists":
      return true;
  }
}

export function evalCond<P extends string>(cond: Cond<P>, context: ResolveContext): boolean {
  if ("all" in cond) return cond.all.every((entry) => evalCond(entry, context));
  if ("any" in cond) return cond.any.some((entry) => evalCond(entry, context));
  if ("not" in cond) return !evalCond(cond.not, context);
  const left = lookup(cond.ref, context);
  if (cond.op === "exists") return cond.value === false ? left === undefined : left !== undefined;
  return left !== undefined && compare(left, cond.op, cond.value ?? null);
}
