import { useEffect, useRef, useState } from "react";
import type {
  AssistantContentBlock,
  AssistantMessage,
  TextContent,
  ThinkingContent,
  ToolCallContent,
} from "@/lib/types";

function streamCharCount(blocks: readonly AssistantContentBlock[]): number {
  let chars = 0;
  for (const block of blocks) {
    if (block.type === "text") chars += (block as TextContent).text?.length ?? 0;
    else if (block.type === "thinking") chars += (block as ThinkingContent).thinking?.length ?? 0;
    else if (block.type === "toolCall") chars += JSON.stringify((block as ToolCallContent).input ?? {}).length;
  }
  return chars;
}

export function StreamSpeedHint({ message }: { message: AssistantMessage }) {
  const blocksRef = useRef<readonly AssistantContentBlock[]>([]);
  blocksRef.current = message.content ?? [];
  const streamStartRef = useRef<number | null>(null);
  const [tps, setTps] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => {
      const chars = streamCharCount(blocksRef.current);
      if (chars === 0) return;
      const now = Date.now();
      if (streamStartRef.current === null) streamStartRef.current = now;
      const elapsed = (now - streamStartRef.current) / 1000;
      if (elapsed > 0.5) setTps(chars / 4 / elapsed);
    };
    const id = setInterval(tick, 300);
    return () => clearInterval(id);
  }, []);

  const estimatedTokens = Math.round(streamCharCount(message.content ?? []) / 4);
  if (estimatedTokens <= 0) return null;

  return (
    <div
      className="type-mono-label"
      style={{
        color: "var(--fx-text-tertiary)",
        marginBottom: 6,
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <span
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          color: "var(--fx-text-tertiary)",
          fontVariantNumeric: "tabular-nums",
        }}
        title="Estimated token count while streaming"
      >
        <span>{estimatedTokens.toLocaleString()} tok</span>
        {tps !== null && (
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span
              aria-hidden="true"
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background:
                  tps >= 50
                    ? "var(--fx-status-success-text)"
                    : tps >= 15
                      ? "var(--fx-status-warning-text)"
                      : "var(--fx-status-danger-text)",
              }}
            />
            <span>{tps.toFixed(1)} t/s</span>
          </span>
        )}
      </span>
    </div>
  );
}
