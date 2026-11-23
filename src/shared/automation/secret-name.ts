import type { SecretName } from "./spec";

export const AUTOMATION_SECRET_NAME_RE = /^[a-z0-9._-]{1,80}$/;
export const MAX_AUTOMATION_SECRET_VALUE_BYTES = 65_536;

export function isAutomationSecretName(value: unknown): value is SecretName {
  return typeof value === "string" && AUTOMATION_SECRET_NAME_RE.exec(value)?.[0] === value;
}

export function isAutomationSecretValue(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    Buffer.byteLength(value, "utf8") <= MAX_AUTOMATION_SECRET_VALUE_BYTES
  );
}
