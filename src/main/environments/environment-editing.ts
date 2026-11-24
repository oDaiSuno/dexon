import type { EnvironmentDraft } from "../../contract/environment-commands.ts";
import type { EnvironmentDescriptor } from "../../contract/environment.ts";
import { EnvironmentConnectionError } from "./supervisor-policy.ts";
import type { StoredEnvironment } from "./environment-store.ts";
import { parseAddEnvironmentInput } from "./environment-store.ts";
import { targetConnectionKey } from "./ssh-scripts.ts";
export function assertUniqueEnvironmentTarget(
  configuration: StoredEnvironment,
  configurations: Iterable<StoredEnvironment>,
  excludedId?: string,
): void {
  const key =
    configuration.target.kind === "ssh" ? targetConnectionKey(configuration.target) : configuration.target.url;
  for (const existing of configurations) {
    if (existing.id === excludedId) continue;
    const target = existing.target;
    if (target.kind !== configuration.target.kind) continue;
    if ((target.kind === "ssh" ? targetConnectionKey(target) : target.url) === key)
      throw new Error("Environment target already exists");
  }
}
export function bindEnvironmentIdentity(
  configuration: StoredEnvironment,
  descriptor: EnvironmentDescriptor,
  configurations: Iterable<StoredEnvironment>,
  persist: () => void,
): void {
  for (const existing of configurations) {
    if (existing.id !== configuration.id && existing.target.expectedEnvironmentId === descriptor.environmentId)
      throw new EnvironmentConnectionError(
        "blocked",
        "configuration",
        "Remote environment identity is already registered",
      );
  }
  if (configuration.target.expectedEnvironmentId === descriptor.environmentId) return;
  configuration.target.expectedEnvironmentId = descriptor.environmentId;
  try {
    persist();
  } catch (error) {
    delete configuration.target.expectedEnvironmentId;
    throw error;
  }
}
export function planEnvironmentUpdate(
  current: StoredEnvironment,
  draft: EnvironmentDraft,
): { configuration: StoredEnvironment; rebind: boolean; reconnect: boolean } {
  const key = (target: StoredEnvironment["target"]) =>
    target.kind === "ssh" ? `ssh:${targetConnectionKey(target)}` : `websocket:${target.url}`;
  const candidate = parseAddEnvironmentInput({
    ...draft,
    enabled: current.enabled,
  });
  const rebind = key(current.target) !== key(candidate.target);
  const keepToken = !rebind || (current.target.kind === "ssh" && candidate.target.kind === "ssh");
  const parsed =
    keepToken && draft.authToken === undefined && current.authToken !== undefined
      ? parseAddEnvironmentInput({
          ...draft,
          authToken: current.authToken,
          enabled: current.enabled,
        })
      : candidate;
  if (!rebind && current.target.expectedEnvironmentId)
    parsed.target.expectedEnvironmentId = current.target.expectedEnvironmentId;
  return {
    configuration: { ...parsed, id: current.id, enabled: current.enabled },
    rebind,
    reconnect: rebind || parsed.authToken !== current.authToken,
  };
}
