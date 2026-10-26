import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import { useI18n } from "@/i18n";
import type { ThinkingExpansionStore } from "@/lib/thinking-expansion-store";
import { formatTurnDuration } from "@/lib/process-flow";
import { useDelayedUnmount } from "./messages/shared";

export function ProcessDetailsGroup({
  messageCount,
  toolCallCount,
  createdSessionCount = 0,
  durationSeconds,
  children,
  stateKey,
  expansionStore,
}: Props) {
  const getSnapshot = useMemo(() => () => expansionStore.getSnapshot(stateKey), [expansionStore, stateKey]);
  const expanded = useSyncExternalStore(expansionStore.subscribe, getSnapshot, getSnapshot);
  const contentMounted = useDelayedUnmount(expanded);
  const { language, t } = useI18n();
  const durationLabel =
    durationSeconds !== undefined && durationSeconds > 0 ? formatTurnDuration(durationSeconds) : null;
  const label = durationLabel
    ? `${t("processedLabel", "Processed")} ${durationLabel}`
    : t("processedLabel", "Processed");
  const summary =
    createdSessionCount > 0
      ? createdSessionCount === 1
        ? t("processCreatedOneSession", "· 1 new session")
        : t("processCreatedSessions", "· {count} new sessions").replace("{count}", String(createdSessionCount))
      : null;
  const counts = [
    t("processDetails", "Process details"),
    language === "zh-CN"
      ? `${messageCount} ${t("messagesCount", "messages")}`
      : `${messageCount} ${messageCount === 1 ? "message" : "messages"}`,
    ...(toolCallCount > 0
      ? [
          language === "zh-CN"
            ? `${toolCallCount} ${t("toolCallsCount", "tool calls")}`
            : `${toolCallCount} ${toolCallCount === 1 ? "tool call" : "tool calls"}`,
        ]
      : []),
  ].join(" · ");

  return (
    <div className="chat-acc" data-open={expanded ? "true" : "false"} style={{ marginBottom: 16 }}>
      <button
        type="button"
        className="chat-quiet-head chat-process-head type-body-default"
        aria-expanded={expanded}
        onClick={() => expansionStore.toggle(stateKey)}
        title={
          expanded
            ? t("collapseProcessDetails", "Collapse process details")
            : t("expandProcessDetails", "Expand process details")
        }
      >
        <span className="chat-acc-chevron chat-process-chevron" aria-hidden="true">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
        <span className="chat-process-label">{label}</span>
        {summary && <span className="chat-process-summary">{summary}</span>}
        {!durationLabel && <span className="sr-only">{counts}</span>}
      </button>
      <div className="chat-acc-panel">
        <div className="chat-acc-panel-clip">
          {contentMounted && <div style={{ marginTop: 8, paddingLeft: 4 }}>{children}</div>}
        </div>
      </div>
    </div>
  );
}

interface Props {
  messageCount: number;
  toolCallCount: number;
  createdSessionCount?: number;
  durationSeconds?: number;
  children: ReactNode;
  stateKey: string;
  expansionStore: ThinkingExpansionStore;
}
