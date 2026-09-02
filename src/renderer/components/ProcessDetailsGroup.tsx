import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import { useI18n } from "@/i18n";
import type { ThinkingExpansionStore } from "@/lib/thinking-expansion-store";
import { scaledChatFont } from "@/lib/chat-appearance";
import { useDelayedUnmount } from "./messages/shared";

export function ProcessDetailsGroup({ messageCount, toolCallCount, children, stateKey, expansionStore }: Props) {
  const getSnapshot = useMemo(() => () => expansionStore.getSnapshot(stateKey), [expansionStore, stateKey]);
  const expanded = useSyncExternalStore(expansionStore.subscribe, getSnapshot, getSnapshot);
  const contentMounted = useDelayedUnmount(expanded);
  const { language, t } = useI18n();
  const parts = [
    t("processDetails", "Process details"),
    language === "zh-CN"
      ? `${messageCount} ${t("messagesCount", "messages")}`
      : `${messageCount} ${messageCount === 1 ? "message" : "messages"}`,
  ];
  if (toolCallCount > 0) {
    parts.push(
      language === "zh-CN"
        ? `${toolCallCount} ${t("toolCallsCount", "tool calls")}`
        : `${toolCallCount} ${toolCallCount === 1 ? "tool call" : "tool calls"}`,
    );
  }

  return (
    <div className="chat-acc" data-open={expanded ? "true" : "false"} style={{ marginBottom: 14 }}>
      <button
        type="button"
        className="chat-quiet-head"
        aria-expanded={expanded}
        onClick={() => expansionStore.toggle(stateKey)}
        title={
          expanded
            ? t("collapseProcessDetails", "Collapse process details")
            : t("expandProcessDetails", "Expand process details")
        }
        style={{ fontSize: scaledChatFont(12.5) }}
      >
        <span style={{ color: "var(--bui-ink-3)", display: "flex", flexShrink: 0 }} aria-hidden="true">
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
        <span
          style={{
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: "var(--bui-ink-2)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {parts.join(" · ")}
        </span>
      </button>
      <div className="chat-acc-panel">
        <div className="chat-acc-panel-clip">
          {contentMounted && <div style={{ marginTop: 8, paddingLeft: 5 }}>{children}</div>}
        </div>
      </div>
    </div>
  );
}

interface Props {
  messageCount: number;
  toolCallCount: number;
  children: ReactNode;
  stateKey: string;
  expansionStore: ThinkingExpansionStore;
}
