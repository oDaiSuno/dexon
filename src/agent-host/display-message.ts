import type { AgentMessage, PersistedMessage } from "../shared/types";
import type { AgentEvent } from "./agent-session/types";

export function toDisplayMessage(message: PersistedMessage): AgentMessage | null {
  return message.role === "system" ? null : message;
}

export type DisplayAgentEvent = AgentEvent & {
  readonly message?: AgentMessage;
  readonly messages?: AgentMessage[];
};

export function isDisplayEvent(event: AgentEvent): event is DisplayAgentEvent {
  if (event.type === "message_start" || event.type === "message_update" || event.type === "message_end") {
    return toDisplayMessage(event.message as PersistedMessage) !== null;
  }
  return true;
}

export function toDisplayEvent(event: AgentEvent): DisplayAgentEvent | null {
  if (!isDisplayEvent(event)) return null;
  if (event.type === "agent_end" && Array.isArray(event.messages)) {
    return {
      ...event,
      messages: event.messages.flatMap((message) => toDisplayMessage(message as PersistedMessage) ?? []),
    };
  }
  return event;
}
