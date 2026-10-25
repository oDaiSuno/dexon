import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/i18n";
import { useCopyFeedback } from "@/hooks/useCopyFeedback";
import { CircleAlertIcon, Icon } from "../chat-input/icons";

const COLLAPSED_LINES = 3;
const STATUS_CODE_PREFIX = /^([1-5]\d{2})\s+(\S[\s\S]*)$/;

function splitStatusCode(detail: string): { code: string | null; text: string } {
  const match = STATUS_CODE_PREFIX.exec(detail);
  return match ? { code: match[1], text: match[2] } : { code: null, text: detail };
}

function UpstreamErrorCard({
  title,
  attempts,
  pending,
  children,
  ...rest
}: {
  title: string;
  attempts?: string;
  pending?: boolean;
  children: ReactNode;
  role: "alert" | "status";
  "data-testid"?: string;
}) {
  return (
    <div className="chat-upstream-error" {...rest}>
      <div className="chat-upstream-error-card">
        <div className="chat-upstream-error-title">
          <span className="chat-upstream-error-icon">
            <CircleAlertIcon size={16} />
          </span>
          <span className="type-body-large-medium chat-upstream-error-heading">{title}</span>
          {attempts && <span className="type-mono-label chat-upstream-error-attempts">{attempts}</span>}
          {pending && (
            <span className="chat-upstream-error-spinner">
              <Icon size={13} strokeWidth={2}>
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </Icon>
            </span>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

function UpstreamErrorMessage({ code, children }: { code: string | null; children: ReactNode }) {
  return (
    <div className="chat-upstream-error-message">
      {code && <span className="type-mono-label-strong chat-upstream-error-code">{code}</span>}
      <div className="type-body-relaxed chat-upstream-error-text">{children}</div>
    </div>
  );
}

export function FailureLine({
  detail,
  retried,
  retry,
}: {
  detail: string | null;
  retried?: boolean;
  retry?: { attempt: number; maxAttempts: number };
}) {
  const { t } = useI18n();
  const { copied, copy } = useCopyFeedback();
  const textRef = useRef<HTMLSpanElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const { code, text } = detail
    ? splitStatusCode(detail)
    : { code: null, text: t("upstreamErrorMissing", "The upstream service returned no error message") };

  useLayoutEffect(() => {
    const element = textRef.current;
    if (!element) return;
    setOverflowing(element.getClientRects().length > COLLAPSED_LINES);
  }, [text]);

  const clamped = overflowing && !expanded;

  return (
    <UpstreamErrorCard
      role="alert"
      data-testid="assistant-error-message"
      title={retried || retry ? t("failureRetried", "Retry failed") : t("upstreamRequestFailed", "Request failed")}
      attempts={retry ? `${retry.attempt}/${retry.maxAttempts}` : undefined}
    >
      <UpstreamErrorMessage code={code}>
        <span
          ref={textRef}
          className="chat-failure-text"
          style={clamped ? { WebkitLineClamp: COLLAPSED_LINES } : undefined}
          data-clamped={clamped ? "true" : undefined}
        >
          {text}
        </span>
        <span className="chat-failure-meta">
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
      </UpstreamErrorMessage>
    </UpstreamErrorCard>
  );
}

export function RetryCountdownLine({
  attempt,
  maxAttempts,
  errorMessage,
}: {
  attempt: number;
  maxAttempts: number;
  errorMessage?: string;
}) {
  const { t } = useI18n();
  const detail = errorMessage?.trim();
  const { code, text } = detail ? splitStatusCode(detail) : { code: null, text: "" };

  return (
    <UpstreamErrorCard
      role="status"
      title={t("retryingNow", "Retrying")}
      attempts={`${attempt}/${maxAttempts}`}
      pending
    >
      {text && (
        <UpstreamErrorMessage code={code}>
          <span>{text}</span>
        </UpstreamErrorMessage>
      )}
    </UpstreamErrorCard>
  );
}
