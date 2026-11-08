import { useI18n } from "@/i18n";
import { useExpansion, type ThinkingExpansionStore } from "@/lib/thinking-expansion-store";
import { useDelayedUnmount } from "./shared";
import type { ThinkingContent } from "@/lib/types";

export function ThinkingBlock({
  block,
  duration,
  stateKey,
  store,
  streaming,
  unanswered,
}: {
  block: ThinkingContent;
  duration?: number;
  stateKey: string;
  store?: ThinkingExpansionStore;
  streaming?: boolean;
  unanswered?: boolean;
}) {
  const [expanded, toggle] = useExpansion(store, stateKey);
  const { t } = useI18n();
  const isWorking = streaming === true && duration === undefined;
  const showTrace = expanded ?? (unanswered || isWorking);
  const traceMounted = useDelayedUnmount(showTrace);
  const preview = block.thinking.trim().replace(/\s+/g, " ");

  return (
    <div className="chat-acc" data-open={showTrace ? "true" : "false"}>
      <button
        type="button"
        className="chat-quiet-head chat-think-row"
        aria-expanded={showTrace}
        onClick={() => toggle(showTrace)}
      >
        <span className="chat-tool-icon chat-think-spark" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
          </svg>
        </span>
        <span className={`chat-tool-name type-body-medium${isWorking ? " chat-shimmer-text" : ""}`}>
          {t("thinkingLabel", "Deep thinking")}
        </span>
        <span className="chat-tool-chip type-mono-label">
          <span className="chat-tool-chip-text">{preview}</span>
        </span>
        {duration !== undefined && <span className="chat-tool-meta type-mono-label">{duration}s</span>}
      </button>
      <div className="chat-acc-panel">
        <div className="chat-acc-panel-clip">
          {traceMounted && <div className="chat-think-box type-body-relaxed">{block.thinking}</div>}
        </div>
      </div>
    </div>
  );
}
