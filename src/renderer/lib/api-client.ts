import { clearLastKnownGoodModels } from "./last-known-good-models";
import type { PiRpc } from "@contract/rpc";
import { PRIMARY_ENVIRONMENT_ID, type EnvironmentId } from "@contract/environment";
import { createEnvironmentApiClient } from "./environment-connection";
import { environmentRegistry, getEnvironmentConnection } from "./environment-registry";

export function resetRpc(): void {
  clearLastKnownGoodModels();
  environmentRegistry.findConnection(PRIMARY_ENVIRONMENT_ID)?.close();
}

export function ensureRpc(): Promise<PiRpc> {
  return getEnvironmentConnection(PRIMARY_ENVIRONMENT_ID).ensureRpc();
}

export function getEnvironmentApiClient(environmentId: EnvironmentId) {
  return createEnvironmentApiClient(getEnvironmentConnection(environmentId));
}
