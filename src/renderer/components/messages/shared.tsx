import { useEffect, useState } from "react";
import type { AssistantContentBlock, CustomMessage, ImageContent, TextContent, UserMessage } from "@/lib/types";
import { scaledChatFont } from "@/lib/chat-appearance";

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

export function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / 1024 / 102.4) / 10} MB`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function DeferredContentActions({
  content,
  onLoad,
}: {
  content: unknown;
  onLoad?: (entryId: string, blockIndex?: number) => Promise<void>;
}) {
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  if (!onLoad || !Array.isArray(content)) return null;
  const references = content.flatMap((block) => {
    if (!block || typeof block !== "object") return [];
    const deferred = (block as AssistantContentBlock | TextContent | ImageContent).deferredContent;
    return deferred ? [deferred] : [];
  });
  if (references.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
      {references.map((reference) => {
        const key = `${reference.entryId}:${reference.blockIndex ?? 0}`;
        const loading = loadingKey === key;
        return (
          <button
            key={key}
            type="button"
            disabled={loading}
            onClick={() => {
              setLoadingKey(key);
              setLoadError(false);
              void onLoad(reference.entryId, reference.blockIndex)
                .catch(() => setLoadError(true))
                .finally(() => setLoadingKey(null));
            }}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "var(--bg-panel)",
              color: "var(--accent)",
              cursor: loading ? "default" : "pointer",
              fontSize: scaledChatFont(11),
              padding: "4px 8px",
            }}
          >
            {loading ? "Loading full content…" : `Load full content (${formatByteSize(reference.originalBytes)})`}
          </button>
        );
      })}
      {loadError && (
        <span style={{ color: "var(--danger)", fontSize: scaledChatFont(11) }}>Failed to load full content</span>
      )}
    </div>
  );
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
