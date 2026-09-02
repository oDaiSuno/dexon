import { useEffect, useRef, useState } from "react";
import type { AssistantContentBlock, CustomMessage, ImageContent, TextContent, UserMessage } from "@/lib/types";

/* Accordion companion: keep content mounted while the collapse animation
   plays, then unmount it so collapsed blocks cost nothing (long sessions
   render hundreds of tool calls). Expanding mounts immediately. */
export function useDelayedUnmount(open: boolean, delayMs = 350): boolean {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return undefined;
    }
    const timer = setTimeout(() => setMounted(false), delayMs);
    return () => clearTimeout(timer);
  }, [open, delayMs]);
  return mounted;
}

/* transitions.dev 30-streaming-text tokenizer: CJK resolves per glyph,
   latin per word, whitespace preserved. Keys are absolute character
   offsets in the growing text so existing tokens never replay. */
const STREAM_TOKEN_PATTERN = "[\\u4e00-\\u9fff\\u3000-\\u303f\\uff00-\\uffef]|[a-zA-Z0-9$@._/-]+|\\s+|[^\\s]";

export function tokenizeStreamTail(tail: string, offsetBase: number): Array<{ start: number; text: string }> {
  const tokens: Array<{ start: number; text: string }> = [];
  for (const match of tail.matchAll(new RegExp(STREAM_TOKEN_PATTERN, "g"))) {
    tokens.push({ start: offsetBase + (match.index ?? 0), text: match[0] });
  }
  return tokens;
}

export function formatTime(ts?: number): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  const now = new Date();
  const isToday =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (isToday) return time;
  const date = d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
  return `${date} ${time}`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/* Deferred blocks (oversized tool outputs, traces, images) land as small
   previews plus a reference into the session file. The full body loads
   automatically in the background — nothing to click; the preview is only
   visible for the first moments after a history page arrives. */
export function DeferredContentActions({
  content,
  onLoad,
}: {
  content: unknown;
  onLoad?: (entryId: string, blockIndex?: number) => Promise<void>;
}) {
  const attemptedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!onLoad || !Array.isArray(content)) return;
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const deferred = (block as AssistantContentBlock | TextContent | ImageContent).deferredContent;
      if (!deferred) continue;
      const key = `${deferred.entryId}:${deferred.blockIndex ?? 0}`;
      if (attemptedRef.current.has(key)) continue;
      attemptedRef.current.add(key);
      // One attempt per mount; on failure the preview stays and the next
      // session reload mounts a fresh loader.
      void onLoad(deferred.entryId, deferred.blockIndex).catch(() => undefined);
    }
  }, [onLoad, content]);
  return null;
}

export function getMessageText(content: CustomMessage["content"] | UserMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((b): b is TextContent => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

export function getMessageImages(content: CustomMessage["content"] | UserMessage["content"]): ImageContent[] {
  if (typeof content === "string") return [];
  return content.filter((b): b is ImageContent => b.type === "image" && !b.deferredContent);
}

export function imageSource(img: ImageContent): string {
  const flat = img as unknown as { data?: string; mimeType?: string };
  if (img.source) {
    return img.source.type === "base64"
      ? `data:${img.source.media_type};base64,${img.source.data}`
      : (img.source.url ?? "");
  }
  return flat.data ? `data:${flat.mimeType};base64,${flat.data}` : "";
}

export function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
