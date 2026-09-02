import { useMemo, useRef, useSyncExternalStore } from "react";
import { scaledChatFont } from "@/lib/chat-appearance";
import { useI18n } from "@/i18n";
import { ThinkingExpansionStore } from "@/lib/thinking-expansion-store";
import type { ThinkingContent } from "@/lib/types";

export function ThinkingBlock({
  block,
  duration,
  stateKey,
  store,
}: {
  block: ThinkingContent;
  duration?: number;
  stateKey: string;
  store?: ThinkingExpansionStore;
}) {
  const localStoreRef = useRef<ThinkingExpansionStore | null>(null);
  if (!localStoreRef.current) localStoreRef.current = new ThinkingExpansionStore(1);
  const stateStore = store ?? localStoreRef.current;
  const getSnapshot = useMemo(() => () => stateStore.getSnapshot(stateKey), [stateKey, stateStore]);
  const expanded = useSyncExternalStore(stateStore.subscribe, getSnapshot, getSnapshot);
  const { t } = useI18n();
  const toggleExpanded = () => stateStore.toggle(stateKey);
  return (
    <div
      style={{
        border: "1px dashed var(--thinking-border)",
        borderRadius: 9,
        overflow: "hidden",
        fontSize: scaledChatFont(13),
        background: "var(--thinking-bg)",
      }}
    >
      <button
        onClick={toggleExpanded}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: "7px 12px",
          background: "none",
          border: "none",
          color: "var(--text-dim)",
          cursor: "pointer",
          fontSize: scaledChatFont(11.5),
          fontFamily: "var(--font-mono)",
          textAlign: "left",
        }}
      >
        <span style={{ fontSize: 10 }}>{expanded ? "▾" : "▸"}</span>
        <span>{t("thinkingLabel", "thinking")}</span>
        {duration !== undefined && (
          <span
            style={{
              marginLeft: "auto",
              fontSize: scaledChatFont(11),
              color: "var(--text-dim)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {duration}s
          </span>
        )}
        {duration === undefined && !expanded && (
          <span style={{ marginLeft: "auto", fontSize: scaledChatFont(11), color: "var(--text-dim)" }}>
            {t("collapsed", "collapsed")}
          </span>
        )}
      </button>
      {expanded && (
        <div
          style={{
            padding: "0 12px 10px",
            color: "var(--text-muted)",
            fontSize: scaledChatFont(12.5),
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            fontStyle: "italic",
          }}
        >
          {block.thinking}
        </div>
      )}
    </div>
  );
}
