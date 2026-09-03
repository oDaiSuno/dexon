import { useI18n } from "@/i18n";
import type { QueuedMessages, CompactResultInfo } from "@/hooks/useAgentSession";
import { scaledChatFont } from "@/lib/chat-appearance";
import { splitLocalFileReferenceMarkdown } from "@/lib/file-url";
import { RecallIcon, RetryIcon } from "./icons";
import { formatTokenCount } from "./SessionControls";

function QueuedMessageRow({ kind, text }: { kind: "steer" | "follow-up"; text: string }) {
  const { t } = useI18n();
  const segments = splitLocalFileReferenceMarkdown(text);
  return (
    <div
      title={text}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "4px 12px",
        fontSize: scaledChatFont(12),
        color: "var(--text-muted)",
        minWidth: 0,
      }}
    >
      <span
        style={{
          flexShrink: 0,
          fontSize: scaledChatFont(10),
          fontFamily: "var(--font-mono)",
          padding: "1px 8px",
          borderRadius: "var(--radius-pill)",
          border: `1px solid ${
            kind === "steer" ? "color-mix(in srgb, var(--accent) 45%, transparent)" : "var(--border)"
          }`,
          color: kind === "steer" ? "var(--accent)" : "var(--text-dim)",
        }}
      >
        {kind === "steer" ? t("steer", "Steer") : t("followUp", "Follow-up")}
      </span>
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {segments.map((seg, i) =>
          seg.file === null ? (
            <span key={i}>{seg.text}</span>
          ) : (
            <span
              key={i}
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "0 8px",
                margin: "0 2px",
                borderRadius: "var(--radius-chip)",
                border: "1px solid var(--border)",
                background: "var(--bg-subtle)",
                color: "var(--text)",
                fontSize: scaledChatFont(11),
                verticalAlign: "baseline",
              }}
            >
              {seg.text}
            </span>
          ),
        )}
      </span>
    </div>
  );
}

export function QueuedMessagesPanel({
  queuedMessages,
  onRecallQueue,
}: {
  queuedMessages: QueuedMessages;
  onRecallQueue?: () => void;
}) {
  const { t } = useI18n();
  const total = queuedMessages.steering.length + queuedMessages.followUp.length;
  return (
    <div
      style={{
        marginBottom: 8,
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-control)",
        background: "var(--bg-panel)",
        padding: "4px 0",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "2px 8px 4px 12px",
        }}
      >
        <span
          style={{
            fontSize: scaledChatFont(10),
            fontFamily: "var(--font-mono)",
            color: "var(--text-dim)",
            textTransform: "uppercase",
            letterSpacing: 0.4,
          }}
        >
          {t("queued", "Queued")} · {total}
        </span>
        {onRecallQueue && (
          <button
            onClick={onRecallQueue}
            title={t(
              "recallQueueDescription",
              "Remove all queued messages and put them back into the input box for editing",
            )}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "4px 12px",
              fontSize: scaledChatFont(12),
              color: "var(--text)",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-card)",
              cursor: "pointer",
              transition: "background 0.12s, border-color 0.12s",
              whiteSpace: "nowrap",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--bg-hover)";
              e.currentTarget.style.borderColor = "color-mix(in srgb, var(--accent) 45%, var(--border))";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.borderColor = "var(--border)";
            }}
          >
            <RecallIcon size={13} />
            {t("recallToInput", "Recall to input")}
          </button>
        )}
      </div>
      {queuedMessages.steering.map((text, i) => (
        <QueuedMessageRow key={`steer-${i}`} kind="steer" text={text} />
      ))}
      {queuedMessages.followUp.map((text, i) => (
        <QueuedMessageRow key={`followup-${i}`} kind="follow-up" text={text} />
      ))}
    </div>
  );
}

export function RetryBanner({
  retryInfo,
}: {
  retryInfo: { attempt: number; maxAttempts: number; errorMessage?: string };
}) {
  const { t } = useI18n();
  return (
    <div
      style={{
        marginBottom: 8,
        padding: "4px 12px",
        background: "var(--warning-soft)",
        border: "1px solid var(--warning-border)",
        borderRadius: "var(--radius-control)",
        fontSize: scaledChatFont(12),
        color: "rgba(180,130,0,0.9)",
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <RetryIcon size={11} />
      {t("retrying", "Retrying")} ({retryInfo.attempt}/{retryInfo.maxAttempts})…
      {retryInfo.errorMessage && <span style={{ opacity: 0.7, marginLeft: 4 }}>— {retryInfo.errorMessage}</span>}
    </div>
  );
}

export function NoticeBanner({
  message,
  onDismiss,
  dismissLabel,
  testId,
}: {
  message: string;
  onDismiss: () => void;
  dismissLabel: string;
  testId?: string;
}) {
  return (
    <div
      role="alert"
      data-testid={testId}
      style={{
        marginBottom: 8,
        padding: "4px 12px",
        background: "color-mix(in srgb, var(--danger) 8%, transparent)",
        border: "1px solid color-mix(in srgb, var(--danger) 28%, var(--border))",
        borderRadius: "var(--radius-control)",
        fontSize: scaledChatFont(12),
        color: "var(--danger)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
      }}
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={dismissLabel}
        style={{
          border: "none",
          background: "transparent",
          color: "inherit",
          cursor: "pointer",
          padding: 2,
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  );
}

/** Success note after a finished compaction: tokens before → after, saved. */
export function CompactResultBanner({ result }: { result?: CompactResultInfo | null }) {
  if (!result) return null;
  const savedTokens = Math.max(0, result.tokensBefore - result.estimatedTokensAfter);
  const verb =
    result.reason && result.reason !== "manual"
      ? `${result.reason[0].toUpperCase()}${result.reason.slice(1)} compacted`
      : "Compacted";
  return (
    <div
      style={{
        marginBottom: 8,
        padding: "4px 12px",
        background: "var(--success-soft)",
        border: "1px solid var(--success-border)",
        borderRadius: "var(--radius-control)",
        fontSize: scaledChatFont(12),
        color: "var(--success)",
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ flexShrink: 0 }}
        aria-hidden="true"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
      {`${verb} ${formatTokenCount(result.tokensBefore)} -> ${formatTokenCount(result.estimatedTokensAfter)} tokens (${formatTokenCount(savedTokens)} saved)`}
    </div>
  );
}
