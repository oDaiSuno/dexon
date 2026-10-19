import type {
  AssistantContentBlock,
  AssistantMessage,
  CustomMessage,
  ThinkingContent,
  ToolCallContent,
  ToolResultMessage,
} from "./types";
import type { ToolMessageData } from "./tool-message-index";
import { isEmptyThinkingBlock } from "../../shared/message-display.ts";

/**
 * Flattened, order-preserving stream of "process" content for the collapsed
 * process-details group: thinking rows, tool-call rows and custom messages
 * interleave exactly in the order the agent produced them.
 */
export type ProcessFlowItem =
  | {
      kind: "thinking";
      key: string;
      block: ThinkingContent;
      /** Index used for the expansion-state key; matches the legacy per-message key. */
      blockIndex: number;
      entryId?: string;
      duration?: number;
    }
  | {
      kind: "toolCall";
      key: string;
      block: ToolCallContent;
      blockIndex: number;
      entryId?: string;
      result?: ToolResultMessage;
      duration?: number;
    }
  | { kind: "custom"; key: string; message: CustomMessage; entryId?: string };

export interface ProcessFlowSource {
  message: AssistantMessage | CustomMessage;
  /** Block subset to render; defaults to the message's own content. */
  blocks?: AssistantContentBlock[];
  firstBlockIndex?: number;
  entryId?: string;
  /** Timestamp of the preceding message, used to derive thinking durations. */
  prevTimestamp?: number;
  toolData?: ToolMessageData;
}

export type ProcessFlowKeyFor = (message: object, entryId?: string) => string;

export interface ProcessFlow {
  items: ProcessFlowItem[];
  /** Number of contributing messages — mirrors the legacy header count. */
  messageCount: number;
  toolCallCount: number;
}

export function buildProcessFlowItems(sources: ProcessFlowSource[], keyFor: ProcessFlowKeyFor): ProcessFlow {
  const items: ProcessFlowItem[] = [];
  let messageCount = 0;
  let toolCallCount = 0;

  for (const source of sources) {
    if (source.message.role === "custom") {
      messageCount += 1;
      items.push({
        kind: "custom",
        key: keyFor(source.message, source.entryId),
        message: source.message,
        entryId: source.entryId,
      });
      continue;
    }
    const message = source.message as AssistantMessage;
    const content = source.blocks ?? message.content ?? [];
    const firstBlockIndex = source.firstBlockIndex ?? 0;
    let contributed = false;
    content.forEach((block, index) => {
      const blockIndex = firstBlockIndex + index;
      const entryId = source.entryId;
      if (block.type === "thinking") {
        if (isEmptyThinkingBlock(block)) return;
        contributed = true;
        items.push({
          kind: "thinking",
          key: keyFor(message, entryId) + `:${blockIndex}`,
          block,
          blockIndex,
          entryId,
          duration: thinkingDurationSeconds(message, source.prevTimestamp),
        });
      } else if (block.type === "toolCall") {
        contributed = true;
        toolCallCount += 1;
        items.push({
          kind: "toolCall",
          key: keyFor(message, entryId) + `:${blockIndex}`,
          block,
          blockIndex,
          entryId,
          result: source.toolData?.results.get(block.toolCallId),
          duration: source.toolData?.durations.get(block.toolCallId),
        });
      }
    });
    if (contributed) messageCount += 1;
  }

  return { items, messageCount, toolCallCount };
}

/** Whole-turn duration: user message → final assistant message, in whole seconds. */
export function computeTurnDurationSeconds(userTimestamp?: number, finalTimestamp?: number): number | undefined {
  if (!userTimestamp || !finalTimestamp) return undefined;
  const seconds = Math.round((finalTimestamp - userTimestamp) / 1000);
  return seconds > 0 ? seconds : undefined;
}

/** Compact turn duration: 42s · 2m11s · 1h2m */
export function formatTurnDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) return `${hours}h${minutes}m`;
  if (minutes > 0) return `${minutes}m${rest}s`;
  return `${rest}s`;
}

function thinkingDurationSeconds(message: AssistantMessage, prevTimestamp?: number): number | undefined {
  if (!message.timestamp || !prevTimestamp) return undefined;
  const seconds = Math.round((message.timestamp - prevTimestamp) / 1000);
  return seconds > 0 ? seconds : undefined;
}
