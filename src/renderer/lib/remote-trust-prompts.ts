import type { RemoteTrustPromptEvent } from "@contract/workspace";

export function updateRemoteTrustPrompts(
  current: readonly RemoteTrustPromptEvent[],
  event: RemoteTrustPromptEvent,
): readonly RemoteTrustPromptEvent[] {
  const remaining = current.filter((prompt) => prompt.promptId !== event.promptId);
  return event.status === "pending" ? [...remaining, event] : remaining;
}
