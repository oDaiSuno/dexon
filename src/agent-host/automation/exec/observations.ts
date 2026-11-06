import type { EffectError, EffectErrorCode, EffectObservation } from "../../effect-observation";
import type { Json } from "../../../shared/automation/spec";
import type { EffectPolicy } from "../core/plan";

export function rejected(code: EffectErrorCode, message: string, transient = false): EffectObservation<never> {
  return { kind: "not_applied", transient, error: { code, message } };
}
export function interrupted(policy: EffectPolicy, error: EffectError): EffectObservation<never> {
  return policy.kind === "read" ? { kind: "not_applied", transient: true, error } : { kind: "maybe_applied", error };
}
export class OutputLimitError extends Error {}
export function parseOutput(text: string, maxBytes: number): Json {
  if (Buffer.byteLength(text) > maxBytes) throw new OutputLimitError("Output exceeds the configured byte limit");
  return JSON.parse(text) as Json;
}
