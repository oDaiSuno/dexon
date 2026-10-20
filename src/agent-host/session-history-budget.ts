import type {
  AgentMessage,
  DeferredContentRef,
  ImageContent,
  TextContent,
  ThinkingContent,
  ToolCallContent,
} from "../shared/types";

const DEFER_THRESHOLD_BYTES = 128 * 1024;
const DEFER_PREVIEW_BYTES = 16 * 1024;
const MIN_DEFER_BYTES = 4 * 1024;
const TIGHT_PREVIEW_BYTES = 2 * 1024;

export interface DisplayMessageItem {
  message: AgentMessage;
  entryId: string;
}

interface ContentCandidate {
  bytes: number;
  defer: (previewBytes: number) => void;
}

export interface UnitFit<T extends DisplayMessageItem> {
  items: T[];
  complete: boolean;
}

function cloneMessages(unit: DisplayMessageItem[]): AgentMessage[] {
  return unit.map(({ message }) => {
    const cloned = { ...message } as AgentMessage;
    if (Array.isArray(message.content)) {
      cloned.content = message.content.map((block) => ({ ...block })) as AgentMessage["content"];
    }
    return cloned;
  });
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function utf8Preview(text: string, previewBytes: number): string {
  const buffer = Buffer.from(text, "utf8");
  if (buffer.length <= previewBytes) return text;
  let preview = buffer.subarray(0, previewBytes).toString("utf8");
  if (preview.endsWith("�")) preview = preview.slice(0, -1);
  return `${preview}\n\n… [content truncated; load full content]`;
}

function collectContentCandidates(messages: AgentMessage[], entryIds: string[]): ContentCandidate[] {
  const candidates: ContentCandidate[] = [];
  messages.forEach((message, messageIndex) => {
    const entryId = entryIds[messageIndex];
    if (typeof message.content === "string") {
      const original = message.content;
      const bytes = Buffer.byteLength(original, "utf8");
      const deferredContent: DeferredContentRef = { entryId, blockIndex: 0, originalBytes: bytes, contentType: "text" };
      candidates.push({
        bytes,
        defer: (previewBytes) => {
          message.content = [{ type: "text", text: utf8Preview(original, previewBytes), deferredContent }];
        },
      });
      return;
    }
    message.content.forEach((block, blockIndex) => {
      if (block.type === "text") {
        const original = block.text;
        const bytes = Buffer.byteLength(original, "utf8");
        const deferredContent: DeferredContentRef = {
          entryId,
          blockIndex,
          originalBytes: bytes,
          contentType: "text",
        };
        candidates.push({
          bytes,
          defer: (previewBytes) => {
            (message.content as TextContent[])[blockIndex] = {
              ...block,
              text: utf8Preview(original, previewBytes),
              deferredContent,
            };
          },
        });
      } else if (block.type === "thinking") {
        const original = block.thinking;
        const bytes = Buffer.byteLength(original, "utf8");
        const deferredContent: DeferredContentRef = {
          entryId,
          blockIndex,
          originalBytes: bytes,
          contentType: "thinking",
        };
        candidates.push({
          bytes,
          defer: (previewBytes) => {
            (message.content as ThinkingContent[])[blockIndex] = {
              ...block,
              thinking: utf8Preview(original, previewBytes),
              deferredContent,
            };
          },
        });
      } else if (block.type === "toolCall") {
        const serializedInput = JSON.stringify(block.input ?? {});
        const bytes = Buffer.byteLength(serializedInput, "utf8");
        const deferredContent: DeferredContentRef = {
          entryId,
          blockIndex,
          originalBytes: bytes,
          contentType: "toolCall",
        };
        candidates.push({
          bytes,
          defer: (previewBytes) => {
            (message.content as ToolCallContent[])[blockIndex] = {
              ...block,
              input: { preview: utf8Preview(serializedInput, previewBytes) },
              deferredContent,
            };
          },
        });
      } else if (block.type === "image") {
        const bytes = byteLength(block);
        const deferredContent: DeferredContentRef = {
          entryId,
          blockIndex,
          originalBytes: bytes,
          contentType: "image",
        };
        candidates.push({
          bytes,
          defer: () => {
            (message.content as ImageContent[])[blockIndex] = {
              type: "image",
              source: { type: "url", url: "" },
              deferredContent,
            };
          },
        });
      }
    });
  });
  return candidates.sort((a, b) => b.bytes - a.bytes);
}

export function fitUnitToBudget<T extends DisplayMessageItem>(unit: T[], maxBytes: number): UnitFit<T> | null {
  const messages = cloneMessages(unit);
  const entryIds = unit.map((item) => item.entryId);
  const candidates = collectContentCandidates(messages, entryIds);
  const size = () => byteLength({ messages, entryIds });
  for (const candidate of candidates) {
    if (candidate.bytes <= DEFER_THRESHOLD_BYTES) continue;
    candidate.defer(DEFER_PREVIEW_BYTES);
  }
  if (size() > maxBytes) {
    for (const candidate of candidates) {
      if (candidate.bytes > MIN_DEFER_BYTES) candidate.defer(TIGHT_PREVIEW_BYTES);
    }
  }
  if (size() > maxBytes) {
    for (const candidate of candidates) candidate.defer(TIGHT_PREVIEW_BYTES);
  }
  let dropped = 0;
  while (size() > maxBytes && messages.length - dropped > 1) {
    messages.shift();
    entryIds.shift();
    dropped += 1;
  }
  if (size() > maxBytes) return null;
  return {
    items: unit.slice(dropped).map((item, index) => ({ ...item, message: messages[index] })),
    complete: dropped === 0,
  };
}

export function deferNewestMessage<T extends DisplayMessageItem>(unit: T[]): T {
  const newest = unit[unit.length - 1];
  const [message] = cloneMessages([newest]);
  for (const candidate of collectContentCandidates([message], [newest.entryId])) {
    candidate.defer(TIGHT_PREVIEW_BYTES);
  }
  return { ...newest, message };
}

export function measureItems(items: DisplayMessageItem[]): number {
  return byteLength({
    messages: items.map((item) => item.message),
    entryIds: items.map((item) => item.entryId),
  });
}
