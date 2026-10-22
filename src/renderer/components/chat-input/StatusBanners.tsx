import { useI18n } from "@/i18n";
import type { QueuedMessages, CompactResultInfo } from "@/hooks/useAgentSession";
import { splitLocalFileReferenceMarkdown } from "@/lib/file-url";
import { RecallIcon } from "./icons";
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
        fontSize: 12,
        color: "var(--fx-text-secondary)",
        minWidth: 0,
      }}
    >
      <span
        style={{
          flexShrink: 0,
          fontSize: 10,
          fontFamily: "var(--font-mono)",
          padding: "1px 8px",
          borderRadius: "var(--radius-pill)",
          border: `1px solid ${
            kind === "steer" ? "color-mix(in srgb, var(--fx-accent-blue) 45%, transparent)" : "var(--fx-line-default)"
          }`,
          color: kind === "steer" ? "var(--fx-accent-blue)" : "var(--fx-text-tertiary)",
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
                border: "1px solid var(--fx-line-default)",
                background: "var(--bg-subtle)",
                color: "var(--fx-text-primary)",
                fontSize: 11,
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
        border: "1px solid var(--fx-line-default)",
        borderRadius: "var(--radius-control)",
        background: "var(--fx-surface-raised)",
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
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            color: "var(--fx-text-tertiary)",
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
              fontSize: 12,
              color: "var(--fx-text-primary)",
              background: "transparent",
              border: "1px solid var(--fx-line-default)",
              borderRadius: "var(--radius-card)",
              cursor: "pointer",
              transition:
                "background var(--duration-quick, 150ms) var(--ease-smooth-out, ease), border-color var(--duration-quick, 150ms) var(--ease-smooth-out, ease)",
              whiteSpace: "nowrap",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--bg-hover)";
              e.currentTarget.style.borderColor =
                "color-mix(in srgb, var(--fx-accent-blue) 45%, var(--fx-line-default))";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.borderColor = "var(--fx-line-default)";
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
        background: "color-mix(in srgb, var(--fx-status-danger) 8%, transparent)",
        border: "1px solid color-mix(in srgb, var(--fx-status-danger) 28%, var(--fx-line-default))",
        borderRadius: "var(--radius-control)",
        fontSize: 12,
        color: "var(--fx-status-danger)",
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
        background: "var(--fx-status-success-soft)",
        border: "1px solid var(--fx-status-success-border)",
        borderRadius: "var(--radius-control)",
        fontSize: 12,
        color: "var(--fx-status-success)",
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
