import { useSyncExternalStore } from "react";
import type { EnvironmentId } from "@contract/environment";
import { environmentRegistry, getActiveEnvironmentId } from "./environment-registry";

export function useFileEnvironment(environmentId?: EnvironmentId): EnvironmentId {
  const focused = useSyncExternalStore(environmentRegistry.subscribe, getActiveEnvironmentId, getActiveEnvironmentId);
  return environmentId ?? focused;
}
