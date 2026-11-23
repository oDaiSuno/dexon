import type { Api, ApiMethod } from "./api";
import type { WireResponse } from "./rpc";

export type GatekeeperMethod = {
  [K in ApiMethod]: Api[K] extends { access: "gatekeeper" } ? K : never;
}[ApiMethod];

export const GATEKEEPER_METHODS: Record<GatekeeperMethod, true> = {
  "automation.enableTask": true,
  "automation.resolveAttention": true,
  "automation.setSecret": true,
  "automation.deleteSecret": true,
  "automation.listSecretNames": true,
};

export function isGatekeeperMethod(method: unknown): method is GatekeeperMethod {
  return typeof method === "string" && Object.hasOwn(GATEKEEPER_METHODS, method);
}

export function gatekeeperRefusal(message: { id: unknown; method: unknown }): WireResponse | null {
  if (typeof message.id !== "string" || !isGatekeeperMethod(message.method)) return null;
  return {
    kind: "response",
    id: message.id,
    ok: false,
    error: { code: "FORBIDDEN", message: "Automation operation requires desktop authorization" },
  };
}
