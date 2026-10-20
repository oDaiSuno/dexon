import type { ChannelId } from "../../shared/channel-types";
import type { SessionSourceRef } from "../../shared/session-orchestration";
import type { ChannelMessageAttachment } from "../../shared/types";
import type { AgentEvent } from "./types";

export interface MessageSourceDecoration {
  channel?: ChannelId | null;
  attachments?: ChannelMessageAttachment[] | null;
  session?: SessionSourceRef | null;
}

export function decorateUserMessageEvent(event: AgentEvent, decoration: MessageSourceDecoration): AgentEvent {
  if (event.type !== "message_start" && event.type !== "message_end") return event;
  const message = event.message;
  if (!message || typeof message !== "object" || (message as { role?: unknown }).role !== "user") return event;
  if (!decoration.channel && !decoration.session) return event;
  return {
    ...event,
    message: {
      ...(message as Record<string, unknown>),
      ...(decoration.channel ? { channelSource: decoration.channel } : {}),
      ...(decoration.channel && decoration.attachments?.length ? { channelAttachments: decoration.attachments } : {}),
      ...(decoration.session ? { sessionSource: decoration.session } : {}),
    },
  };
}
