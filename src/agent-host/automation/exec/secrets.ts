import type { Json, Text } from "../../../shared/automation/spec";
import type { EffectErrorCode, EffectObservation } from "../../effect-observation";
import type { EffectPolicy } from "../core/plan";
import { renderText, resolveValue } from "../spec/values";
import { interrupted, rejected } from "./observations";
import type { AttemptContext, SecretReader, SecretUseScope } from "./types";

export function createSecretUseScope(reader: SecretReader): SecretUseScope {
  const values = new Set<string>();
  return {
    async read(name) {
      const value = await reader.read(name);
      if (value !== null && value.length > 0) {
        values.add(value);
        values.add(JSON.stringify(value).slice(1, -1));
      }
      return value;
    },
    containsUsedSecret(text) {
      for (const value of values) if (text.includes(value)) return true;
      return false;
    },
  };
}
export function protectObservation(
  observation: EffectObservation<Json>,
  policy: EffectPolicy,
  scope: SecretUseScope,
): EffectObservation<Json> {
  let containsSecret = false;
  const text = JSON.stringify(observation, (key, value: unknown) => {
    if (
      !containsSecret &&
      (scope.containsUsedSecret(key) || (typeof value === "string" && scope.containsUsedSecret(value)))
    )
      containsSecret = true;
    return value;
  });
  if (!containsSecret && !scope.containsUsedSecret(text)) return observation;
  const error = { code: "invalid_input" as const, message: "Executor result contains an approved secret" };
  return policy.kind === "read" ? rejected(error.code, error.message) : interrupted(policy, error);
}

export class SecretError extends Error {
  constructor(readonly code: EffectErrorCode) {
    super(code === "grant_violation" ? "Secret is not approved" : "Approved secret is unavailable");
  }
}
export async function readSecret(name: string, ctx: AttemptContext, reader: SecretReader): Promise<string> {
  if (!ctx.grant.secrets.includes(name)) throw new SecretError("grant_violation");
  let value: string | null;
  try {
    value = await reader.read(name);
  } catch {
    throw new SecretError("missing_secret");
  }
  if (value === null || value.length === 0) throw new SecretError("missing_secret");
  return value;
}
export async function resolveSecrets(value: Json, ctx: AttemptContext, reader: SecretReader): Promise<Json> {
  if (typeof value === "string") {
    const matches = [...value.matchAll(/\{\{secret:([a-zA-Z0-9._-]+)\}\}/g)];
    const values = new Map<string, string>();
    for (const match of matches) values.set(match[1], await readSecret(match[1], ctx, reader));
    const result = value.replace(/\{\{secret:([a-zA-Z0-9._-]+)\}\}/g, (_, name: string) => values.get(name)!);
    return result;
  }
  if (Array.isArray(value)) return Promise.all(value.map((entry) => resolveSecrets(entry, ctx, reader)));
  if (value !== null && typeof value === "object") {
    if (typeof value.$secret === "string") return readSecret(value.$secret, ctx, reader);
    return Object.fromEntries(
      await Promise.all(
        Object.entries(value).map(async ([key, entry]) => [key, await resolveSecrets(entry, ctx, reader)]),
      ),
    );
  }
  return value;
}
export async function secretText(text: Text, ctx: AttemptContext, reader: SecretReader): Promise<string> {
  if (typeof text === "string") return String(await resolveSecrets(text, ctx, reader));
  const masked = text.$tmpl.replace(/\{\{secret:([^}]+)\}\}/g, (_, name: string) => `\u0001${name}\u0002`);
  const rendered = renderText({ $tmpl: masked }, ctx.values).replace(
    /\u0001([^\u0002]+)\u0002/g,
    (_, name: string) => `{{secret:${name}}}`,
  );
  return String(await resolveSecrets(rendered, ctx, reader));
}
export async function secretValue(value: Json, ctx: AttemptContext, reader: SecretReader): Promise<Json> {
  if (value !== null && typeof value === "object") {
    if (Array.isArray(value)) return Promise.all(value.map((entry) => secretValue(entry, ctx, reader)));
    if (typeof value.$secret === "string") return readSecret(value.$secret, ctx, reader);
    if (typeof value.$tmpl === "string") return secretText({ $tmpl: value.$tmpl }, ctx, reader);
    if (typeof value.$ref !== "string")
      return Object.fromEntries(
        await Promise.all(
          Object.entries(value).map(async ([key, entry]) => [key, await secretValue(entry, ctx, reader)]),
        ),
      );
  }
  return resolveSecrets(resolveValue(value, ctx.values), ctx, reader);
}
