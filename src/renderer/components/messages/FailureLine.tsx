import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import { useCopyFeedback } from "@/hooks/useCopyFeedback";
import { scaledChatFont } from "@/lib/chat-appearance";

const COLLAPSED_LINES = 3;

export function FailureLine({ detail, retried }: { detail: string | null; retried?: boolean }) {
  const { t } = useI18n();
  const { copied, copy } = useCopyFeedback();
  const textRef = useRef<HTMLSpanElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const text = detail ?? t("upstreamErrorMissing", "The upstream service returned no error message");

  useLayoutEffect(() => {
    const element = textRef.current;
    if (!element) return;
    setOverflowing(element.getClientRects().length > COLLAPSED_LINES);
  }, [text]);

  const clamped = overflowing && !expanded;

  return (
    <div
      role="alert"
      data-testid="assistant-error-message"
      className="chat-failure-line"
      style={{ fontSize: scaledChatFont(13), marginBottom: 8 }}
    >
      <span aria-hidden="true" className="chat-failure-mark">
        ✕
      </span>
      <span className="chat-failure-body">
        <span
          ref={textRef}
          className="chat-failure-text"
          style={clamped ? { WebkitLineClamp: COLLAPSED_LINES } : undefined}
          data-clamped={clamped ? "true" : undefined}
        >
          {text}
        </span>
        <span className="chat-failure-meta">
          {retried && <span>· {t("failureRetried", "Retried")}</span>}
          {overflowing && (
            <button type="button" className="chat-failure-action" onClick={() => setExpanded((open) => !open)}>
              · {expanded ? t("failureCollapse", "Collapse") : t("failureExpand", "Show all")}
            </button>
          )}
          {detail && (
            <button
              type="button"
              className="chat-failure-action chat-failure-copy"
              data-copied={copied ? "true" : undefined}
              onClick={() => void copy(detail)}
            >
              · {copied ? t("copied", "Copied") : t("failureCopy", "Copy")}
            </button>
          )}
        </span>
      </span>
    </div>
  );
}

export function RetryCountdownLine({ retryAt, onCancel }: { retryAt: number; onCancel: () => void }) {
  const { t } = useI18n();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);

  const seconds = Math.max(0, Math.ceil((retryAt - now) / 1000));
  const label =
    seconds > 0
      ? t("retryInSeconds", "Retrying in {seconds}s").replace("{seconds}", String(seconds))
      : t("retryingNow", "Retrying…");

  return (
    <div role="status" className="chat-failure-line chat-retry-line" style={{ fontSize: scaledChatFont(13) }}>
      <span aria-hidden="true" className="chat-failure-mark chat-retry-mark">
        ↻
      </span>
      <span className="chat-failure-body">
        <span>{label}</span>
        <span className="chat-failure-meta">
          <button type="button" className="chat-failure-action" onClick={onCancel}>
            · {t("cancel", "Cancel")}
          </button>
        </span>
      </span>
    </div>
  );
}
