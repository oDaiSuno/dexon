import { isChannelSourceCancelledType, isChannelSourceType, isRetryOutcomeType } from "./session-entry-compat";
import type {
  AgentMessage,
  AssistantMessage,
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
  const retryByEntryId = retryOutcomesByEntryId(path);
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
    const retry = retryByEntryId.get(entry.id);
    const stripped = withoutModelOnlyFields(message);
    projected.push({
      message: retry ? withRetry(stripped, retry) : stripped,
      entryId: entry.id,
      pathIndex,
    });
  });
  return projected;
}

interface RetryOutcome {
  attempt: number;
  maxAttempts: number;
}

function readRetryOutcome(data: unknown): RetryOutcome | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  const attempt = record.attempt;
  const maxAttempts = record.maxAttempts;
  if (!isPositiveInteger(attempt) || !isPositiveInteger(maxAttempts)) return null;
  return { attempt, maxAttempts };
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function retryOutcomesByEntryId(path: SessionEntry[]): Map<string, RetryOutcome> {
  const outcomes = new Map<string, RetryOutcome>();
  for (const entry of path) {
    if (entry.type !== "custom" || !isRetryOutcomeType(entry.customType) || !entry.parentId) continue;
    const outcome = readRetryOutcome(entry.data);
    if (outcome) outcomes.set(entry.parentId, outcome);
  }
  return outcomes;
}

function withRetry(message: AgentMessage, retry: RetryOutcome): AgentMessage {
  if (message.role !== "assistant" || (message as AssistantMessage).stopReason !== "error") return message;
  return { ...(message as AssistantMessage), retry };
}

export function attachRetryOutcomes(
  messages: AgentMessage[],
  entryIds: string[],
  path: SessionEntry[],
): AgentMessage[] {
  const outcomes = retryOutcomesByEntryId(path);
  if (outcomes.size === 0) return messages;
  let patched = messages;
  messages.forEach((message, index) => {
    const retry = outcomes.get(entryIds[index]);
    if (!retry) return;
    const next = withRetry(message, retry);
    if (next === message) return;
    if (patched === messages) patched = [...messages];
    patched[index] = next;
  });
  return patched;
}
