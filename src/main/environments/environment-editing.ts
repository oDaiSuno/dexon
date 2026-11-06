import type { EnvironmentDraft } from "../../contract/environment-commands.ts";
import type { StoredEnvironment } from "./environment-store.ts";
import { parseAddEnvironmentInput } from "./environment-store.ts";
import { targetConnectionKey } from "./ssh-scripts.ts";
export function planEnvironmentUpdate(
  current: StoredEnvironment,
  draft: EnvironmentDraft,
): { configuration: StoredEnvironment; rebind: boolean; reconnect: boolean } {
  const parsed = parseAddEnvironmentInput({
    ...draft,
    authToken: draft.authToken ?? current.authToken,
    enabled: current.enabled,
  });
  const key = (target: StoredEnvironment["target"]) =>
    target.kind === "ssh" ? `ssh:${targetConnectionKey(target)}` : `websocket:${target.url}`;
  const rebind = key(current.target) !== key(parsed.target);
  if (!rebind && current.target.expectedEnvironmentId)
    parsed.target.expectedEnvironmentId = current.target.expectedEnvironmentId;
  return {
    configuration: { ...parsed, id: current.id, enabled: current.enabled },
    rebind,
    reconnect: rebind || parsed.authToken !== current.authToken,
  };
}
