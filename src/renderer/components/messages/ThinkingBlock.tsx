import { useMemo, useRef, useSyncExternalStore } from "react";
import { scaledChatFont } from "@/lib/chat-appearance";
import { useI18n } from "@/i18n";
import { ThinkingExpansionStore } from "@/lib/thinking-expansion-store";
import { useDelayedUnmount } from "./shared";
import type { ThinkingContent } from "@/lib/types";

export function ThinkingBlock({
  block,
  duration,
  stateKey,
  store,
  streaming,
}: {
  block: ThinkingContent;
  duration?: number;
  stateKey: string;
  store?: ThinkingExpansionStore;
  streaming?: boolean;
}) {
  const localStoreRef = useRef<ThinkingExpansionStore | null>(null);
  if (!localStoreRef.current) localStoreRef.current = new ThinkingExpansionStore(1);
  const stateStore = store ?? localStoreRef.current;
  const getSnapshot = useMemo(() => () => stateStore.getSnapshot(stateKey), [stateKey, stateStore]);
  const expanded = useSyncExternalStore(stateStore.subscribe, getSnapshot, getSnapshot);
  const { t } = useI18n();
  const toggleExpanded = () => stateStore.toggle(stateKey);
  const traceMounted = useDelayedUnmount(expanded);

  // While this thinking block is still growing, the label shimmers; once the
  // duration is known it settles into a quiet "Thought for Ns" statement.
  const isWorking = streaming === true && duration === undefined;
  const label = isWorking
    ? t("thinkingActive", "Thinking")
    : duration !== undefined
      ? t("thoughtForDuration", "Thought for {seconds}s").replace("{seconds}", String(duration))
      : t("thinkingLabel", "thinking");

  return (
    <div className="chat-acc" data-open={expanded ? "true" : "false"}>
      <button type="button" className="chat-quiet-head" aria-expanded={expanded} onClick={toggleExpanded}>
        <span
          className="chat-think-spark"
          style={{ color: isWorking ? "var(--bui-ink-2)" : "var(--bui-ink-3)" }}
          aria-hidden="true"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
          </svg>
        </span>
        <span
          className={isWorking ? "chat-shimmer-text" : undefined}
          style={{
            fontSize: scaledChatFont(13),
            fontWeight: 500,
            color: isWorking ? undefined : "var(--bui-ink-2)",
            whiteSpace: "nowrap",
            ...(isWorking ? {} : { animation: "chat-fade-in var(--duration-medium) var(--ease-out) both" }),
          }}
        >
          {label}
        </span>
        <span className="chat-acc-chevron" style={{ color: "var(--bui-ink-3)" }} aria-hidden="true">
          <svg
            width="14"
            height="14"
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
      </button>
      <div className="chat-acc-panel">
        <div className="chat-acc-panel-clip">
          {traceMounted && (
            <div className="chat-think-trace" style={{ fontSize: scaledChatFont(12.5) }}>
              {block.thinking}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
