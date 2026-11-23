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

export function isGatekeeperMethod(method: string): method is GatekeeperMethod {
  return Object.hasOwn(GATEKEEPER_METHODS, method);
}

export function gatekeeperRefusal(message: { id: string; method: string }): WireResponse | null {
  if (!isGatekeeperMethod(message.method)) return null;
  return {
    kind: "response",
    id: message.id,
    ok: false,
    error: { code: "FORBIDDEN", message: "Automation operation requires desktop authorization" },
  };
}
