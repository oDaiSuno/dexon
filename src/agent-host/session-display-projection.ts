import { isChannelSourceCancelledType, isChannelSourceType } from "./session-entry-compat";
import type {
  AgentMessage,
  ImageContent,
  SessionEntry,
  TextContent,
  ThinkingContent,
  ToolCallContent,
} from "../shared/types";
import { entryToUiMessage, parseChannelSourceMarker, parseRunId, withUserMessageSource } from "./session-reader";

const MODEL_ONLY_BLOCK_FIELDS = ["thinkingSignature", "textSignature", "thoughtSignature"] as const;

export interface ProjectedMessage {
  message: AgentMessage;
  entryId: string;
  pathIndex: number;
}

export type DisplayContentBlock = TextContent | ImageContent | ThinkingContent | ToolCallContent;

export function withoutModelOnlyBlock<T extends DisplayContentBlock>(block: T): T {
  const record = block as unknown as Record<string, unknown>;
  const dropped = MODEL_ONLY_BLOCK_FIELDS.filter((field) => field in record);
  if (dropped.length === 0) return block;
  const clone = { ...record };
  for (const field of dropped) delete clone[field];
  return clone as unknown as T;
}

export function withoutModelOnlyFields(message: AgentMessage): AgentMessage {
  if (typeof message.content === "string" || !Array.isArray(message.content)) return message;
  let changed = false;
  const content = message.content.map((block) => {
    const stripped = withoutModelOnlyBlock(block);
    if (stripped !== block) changed = true;
    return stripped;
  });
  return changed ? ({ ...message, content } as AgentMessage) : message;
}

export function projectDisplayMessages(path: SessionEntry[]): ProjectedMessage[] {
  const projected: ProjectedMessage[] = [];
  let pendingChannelSource: ReturnType<typeof parseChannelSourceMarker> = null;
  path.forEach((entry, pathIndex) => {
    if (entry.type === "custom" && isChannelSourceType(entry.customType)) {
      const marker = parseChannelSourceMarker(entry.data);
      if (marker) pendingChannelSource = marker;
      return;
    }
    if (entry.type === "custom" && isChannelSourceCancelledType(entry.customType)) {
      const runId = parseRunId(entry.data);
      if (!runId || pendingChannelSource?.runId === runId) pendingChannelSource = null;
      return;
    }
    let message = entryToUiMessage(entry);
    if (!message) return;
    if (message.role === "user") {
      message = withUserMessageSource(message, pendingChannelSource?.channel, pendingChannelSource?.attachments);
      pendingChannelSource = null;
    }
    projected.push({ message: withoutModelOnlyFields(message), entryId: entry.id, pathIndex });
  });
  return projected;
}
