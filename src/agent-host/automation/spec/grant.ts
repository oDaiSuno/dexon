import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { resolve, relative, isAbsolute, sep } from "node:path";
import type {
  RequiredGrant,
  ConfirmedGrant,
  ChannelTarget,
  UnattendedWrite,
  AgentWorkspaceTool,
  TaskSpec,
  Json,
} from "../../../shared/automation/spec";
import { effectPolicyFor, type TaskPlan, type ScriptActionPlan } from "../core/plan";

export function canonicalJson(value: unknown): string {
  function sorted(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(sorted);
    if (input !== null && typeof input === "object")
      return Object.fromEntries(
        Object.entries(input)
          .filter(([, item]) => item !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, item]) => [key, sorted(item)]),
      );
    return input;
  }
  return JSON.stringify(sorted(value));
}
export function computePlanHash(plan: TaskPlan): string {
  return createHash("sha256").update(canonicalJson(plan)).digest("hex");
}

export function hashScriptManifest(spec: TaskSpec): Readonly<Record<string, string>> {
  const paths = new Set<string>();
  for (const step of spec.steps)
    if (step.kind === "action" && step.call.action === "script.run") paths.add(step.call.with.path);
  for (const trigger of spec.triggers)
    if (trigger.kind === "watch" && trigger.probe.action === "script.run") paths.add(trigger.probe.with.path);
  if (!paths.size) return {};
  const cwd = realpathSync(spec.cwd);
  return Object.fromEntries(
    [...paths].sort().map((path) => {
      const file = realpathSync(resolve(cwd, path));
      const rel = relative(cwd, file);
      if (isAbsolute(path) || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
        throw new Error("Script must be inside cwd");
      return [path, createHash("sha256").update(readFileSync(file)).digest("hex")];
    }),
  );
}

export interface GrantOptions {
  readonly scriptHashes?: Readonly<Record<string, string>>;
  readonly planHash?: string;
}
export function deriveRequiredGrant(plan: TaskPlan, _spec?: TaskSpec | string, opts: GrantOptions = {}): RequiredGrant {
  const tools = new Set<AgentWorkspaceTool>();
  const targets = new Map<string, ChannelTarget>();
  const notifications = new Map<string, ChannelTarget>();
  const origins = new Set<string>();
  const scripts = new Map<string, string>();
  const secrets = new Set<string>();
  const unattendedWrites: UnattendedWrite[] = [];
  const stepEffects: RequiredGrant["stepEffects"][number][] = [];
  let requiresTrustedLocalExecution = false;
  let approved = false;
  function addScript(call: ScriptActionPlan) {
    const hash = opts.scriptHashes?.[call.path] ?? call.sha256;
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error(`Missing script SHA-256: ${call.path}`);
    scripts.set(call.path, hash);
    call.secrets.forEach((secret) => secrets.add(secret));
    requiresTrustedLocalExecution = true;
  }
  for (const step of plan.steps) {
    if (step.kind === "wait") {
      if (step.wait.kind === "approval" && step.whenCond === null && step.onTimeout !== "continue") approved = true;
      continue;
    }
    const effect = effectPolicyFor(step);
    stepEffects.push({ stepId: step.id, effect: effect.kind });
    let writeKind: UnattendedWrite["kind"];
    let staticTarget = false;
    if (step.kind === "agent") {
      step.tools.forEach((tool) => tools.add(tool));
      requiresTrustedLocalExecution ||= step.tools.includes("bash");
      writeKind = "agent_write";
    } else if (step.call.action === "channel.send") {
      const key = canonicalJson(step.call.to);
      targets.set(key, step.call.to);
      if (step.generatedFrom?.kind === "approval_notify") notifications.set(key, step.call.to);
      writeKind = "channel_send";
      staticTarget = true;
    } else if (step.call.action === "http.request") {
      origins.add(step.call.origin);
      Object.values(step.call.secretHeaders ?? {}).forEach((secret) => secrets.add(secret));
      writeKind = "http_write";
      staticTarget = step.call.pathTmpl === null || typeof step.call.pathTmpl === "string";
    } else {
      addScript(step.call);
      writeKind = "script_write";
      staticTarget = true;
    }
    if (effect.kind !== "read" && step.generatedFrom === null && (!approved || !staticTarget))
      unattendedWrites.push({ stepId: step.id, kind: writeKind });
  }
  for (const trigger of plan.triggers) {
    if (trigger.kind !== "watch") continue;
    if (trigger.probe.action === "script.run") addScript(trigger.probe);
    else {
      origins.add(trigger.probe.origin);
      Object.values(trigger.probe.secretHeaders ?? {}).forEach((secret) => secrets.add(secret));
    }
  }
  return {
    cwd: plan.cwd,
    agentTools: [...tools].sort(),
    channelTargets: [...targets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, target]) => target),
    allowedChannelTargets: [...notifications.values()],
    httpOrigins: [...origins].sort(),
    scripts: [...scripts].sort(([a], [b]) => a.localeCompare(b)).map(([path, sha256]) => ({ path, sha256 })),
    secrets: [...secrets].sort(),
    unattendedWrites,
    requiresTrustedLocalExecution,
    stepEffects,
    planHash: opts.planHash ?? (typeof _spec === "string" ? _spec : computePlanHash(plan)),
  };
}

export type GrantNeed =
  | { readonly kind: "channel"; readonly target: ChannelTarget }
  | { readonly kind: "http"; readonly origin: string }
  | { readonly kind: "script"; readonly path: string; readonly sha256: string }
  | { readonly kind: "secret"; readonly name: string };
export function grantCovers(grant: ConfirmedGrant, need: GrantNeed): boolean {
  switch (need.kind) {
    case "channel":
      return grant.channelTargets.some(
        (target) => target.accountId === need.target.accountId && target.peerId === need.target.peerId,
      );
    case "http":
      return grant.httpOrigins.includes(need.origin);
    case "script":
      return grant.scripts.some((script) => script.path === need.path && script.sha256 === need.sha256);
    case "secret":
      return grant.secrets.includes(need.name);
  }
}

export function requestDigest(value: Json | object): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
