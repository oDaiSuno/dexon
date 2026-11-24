import type { EnvironmentId } from "@contract/environment";
import type { SettingsTab } from "@/components/SettingsConfig";

export interface SettingsRequest {
  tab: SettingsTab;
  environmentId?: EnvironmentId;
}

export interface ResourcesRequest {
  environmentId?: EnvironmentId;
}

type RequestListener = (request: SettingsRequest) => void;
type ResourcesListener = (request: ResourcesRequest) => void;

const listeners = new Set<RequestListener>();
let pending: SettingsRequest | null = null;
const resourcesListeners = new Set<ResourcesListener>();
let pendingResources: ResourcesRequest | null = null;

export function requestSettings(tab: SettingsTab, options?: { environmentId?: EnvironmentId }): void {
  const request: SettingsRequest = { tab, ...(options?.environmentId ? { environmentId: options.environmentId } : {}) };
  if (!listeners.size) {
    pending = request;
    return;
  }
  for (const listener of [...listeners]) listener(request);
}

export function subscribeSettingsRequest(listener: RequestListener): () => void {
  listeners.add(listener);
  if (pending !== null) {
    const request = pending;
    pending = null;
    listener(request);
  }
  return () => {
    listeners.delete(listener);
  };
}

export function requestResources(options?: { environmentId?: EnvironmentId }): void {
  const request: ResourcesRequest = options?.environmentId ? { environmentId: options.environmentId } : {};
  if (!resourcesListeners.size) {
    pendingResources = request;
    return;
  }
  for (const listener of [...resourcesListeners]) listener(request);
}

export function subscribeResourcesRequest(listener: ResourcesListener): () => void {
  resourcesListeners.add(listener);
  if (pendingResources !== null) {
    const request = pendingResources;
    pendingResources = null;
    listener(request);
  }
  return () => {
    resourcesListeners.delete(listener);
  };
}
