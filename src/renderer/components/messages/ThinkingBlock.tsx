import { useMemo, useRef, useSyncExternalStore } from "react";
import { scaledChatFont } from "@/lib/chat-appearance";
import { useI18n } from "@/i18n";
import { ThinkingExpansionStore } from "@/lib/thinking-expansion-store";
import { useDelayedUnmount } from "./shared";
import type { ThinkingContent } from "@/lib/types";

/* Deep-thinking row, isomorphic with tool rows — one shared form for the
   live tail, the final message and the process-details group: spark icon +
   label + gray summary chip + duration, no disclosure arrow. The chip
   toggles the full trace in a gray box below; while the block is still
   streaming the label shimmers and the trace stays open. */
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
  if (!localStoreRef.current) localStoreRef.current = new ThinkingExpansionStore();
  const stateStore = store ?? localStoreRef.current;
  const getSnapshot = useMemo(() => () => stateStore.getSnapshot(stateKey), [stateKey, stateStore]);
  const expanded = useSyncExternalStore(stateStore.subscribe, getSnapshot, getSnapshot);
  const { t } = useI18n();
  const isWorking = streaming === true && duration === undefined;
  const showTrace = expanded || isWorking;
  const traceMounted = useDelayedUnmount(showTrace);
  const preview = block.thinking.trim().replace(/\s+/g, " ");

  return (
    <div className="chat-acc" data-open={showTrace ? "true" : "false"}>
      <button
        type="button"
        className="chat-quiet-head chat-think-row"
        aria-expanded={showTrace}
        onClick={() => stateStore.toggle(stateKey)}
      >
        <span className="chat-tool-icon chat-think-spark" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
          </svg>
        </span>
        <span className={`chat-tool-name${isWorking ? " chat-shimmer-text" : ""}`}>
          {t("thinkingLabel", "Deep thinking")}
        </span>
        <span className="chat-tool-chip">{preview}</span>
        {duration !== undefined && <span className="chat-tool-meta">{duration}s</span>}
      </button>
      <div className="chat-acc-panel">
        <div className="chat-acc-panel-clip">
          {traceMounted && (
            <div className="chat-think-box" style={{ fontSize: scaledChatFont(12.5) }}>
              {block.thinking}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
