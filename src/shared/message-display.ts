import type { AssistantContentBlock, AssistantMessage, TextContent, ThinkingContent } from "./types";

interface DisplayOptions {
  isStreaming?: boolean;
}

export function isAssistantFailure(message: AssistantMessage): boolean {
  return message.stopReason === "error";
}

export function getAssistantFailureDetail(message: AssistantMessage): string | null {
  if (!isAssistantFailure(message)) return null;
  const detail = message.errorMessage?.trim();
  return detail ? detail : null;
}

export function isEmptyThinkingBlock(
  block: AssistantContentBlock,
  options: DisplayOptions = {},
): block is ThinkingContent {
  return block.type === "thinking" && !options.isStreaming && block.thinking.trim() === "";
}

/** Empty text segments render as pointless blank bubbles (e.g. between thinking and tool calls). */
export function isEmptyTextBlock(block: AssistantContentBlock, options: DisplayOptions = {}): block is TextContent {
  return block.type === "text" && !options.isStreaming && block.text.trim() === "";
}

export function getDisplayableAssistantBlocks(
  message: AssistantMessage,
  options: DisplayOptions = {},
): AssistantContentBlock[] {
  return (message.content ?? []).filter(
    (block) => !isEmptyThinkingBlock(block, options) && !isEmptyTextBlock(block, options),
  );
}

export function hasRenderableAssistantMessage(message: AssistantMessage, options: DisplayOptions = {}): boolean {
  return isAssistantFailure(message) || getDisplayableAssistantBlocks(message, options).length > 0;
}

export type AssistantBlockRunKind = "answer" | "process";

export interface AssistantBlockItem {
  block: AssistantContentBlock;
  index: number;
}

export interface AssistantBlockRun {
  kind: AssistantBlockRunKind;
  blockItems: AssistantBlockItem[];
}

function isAnswerBlock(block: AssistantContentBlock): boolean {
  return block.type === "text" || block.type === "image";
}

export function splitAssistantBlockRuns(message: AssistantMessage, options: DisplayOptions = {}): AssistantBlockRun[] {
  const runs: AssistantBlockRun[] = [];
  (message.content ?? []).forEach((block, index) => {
    if (isEmptyThinkingBlock(block, options) || isEmptyTextBlock(block, options)) return;
    const kind: AssistantBlockRunKind = isAnswerBlock(block) ? "answer" : "process";
    const current = runs[runs.length - 1];
    if (current && current.kind === kind) {
      current.blockItems.push({ block, index });
      return;
    }
    runs.push({ kind, blockItems: [{ block, index }] });
  });
  return runs;
}
