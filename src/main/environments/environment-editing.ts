import type { EnvironmentDraft } from "../../contract/environment-commands.ts";
import type { StoredEnvironment } from "./environment-store.ts";
import { parseAddEnvironmentInput } from "./environment-store.ts";
import { targetConnectionKey } from "./ssh-scripts.ts";
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
