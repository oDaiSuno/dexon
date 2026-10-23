import type { ReactNode } from "react";
import { useI18n } from "@/i18n";
import type { QueuedMessages, CompactResultInfo } from "@/hooks/useAgentSession";
import { splitLocalFileReferenceMarkdown } from "@/lib/file-url";
import { CircleAlertIcon, CircleCheckIcon, CloseIcon, RecallIcon, TriangleAlertIcon } from "./icons";
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

export type ComposerBannerTone = "error" | "success" | "warning";

const BANNER_ICONS: Record<ComposerBannerTone, ReactNode> = {
  error: <CircleAlertIcon size={15} />,
  success: <CircleCheckIcon size={15} />,
  warning: <TriangleAlertIcon size={15} />,
};

export function ComposerBanner({
  tone,
  message,
  onDismiss,
  dismissLabel,
  action,
  testId,
}: {
  tone: ComposerBannerTone;
  message: string;
  onDismiss: () => void;
  dismissLabel: string;
  action?: { label: string; onClick: () => void } | null;
  testId?: string;
}) {
  return (
    <div
      role={tone === "success" ? "status" : "alert"}
      data-testid={testId}
      data-tone={tone}
      className="composer-banner"
    >
      <span className="composer-banner-icon">{BANNER_ICONS[tone]}</span>
      <span className="composer-banner-message type-label-default">{message}</span>
      {action && (
        <button type="button" className="feedback-action type-label-medium" onClick={action.onClick}>
          {action.label}
        </button>
      )}
      <button type="button" className="feedback-close" data-size="banner" onClick={onDismiss} aria-label={dismissLabel}>
        <CloseIcon size={14} />
      </button>
    </div>
  );
}

export function CompactResultBanner({ result, onDismiss }: { result: CompactResultInfo; onDismiss: () => void }) {
  const { t } = useI18n();
  const savedTokens = Math.max(0, result.tokensBefore - result.estimatedTokensAfter);
  const template =
    result.reason && result.reason !== "manual"
      ? t("compactResultAuto", "Context compacted automatically: {before} → {after} tokens, {saved} saved")
      : t("compactResultManual", "Context compacted: {before} → {after} tokens, {saved} saved");
  const message = template
    .replace("{before}", formatTokenCount(result.tokensBefore))
    .replace("{after}", formatTokenCount(result.estimatedTokensAfter))
    .replace("{saved}", formatTokenCount(savedTokens));
  return (
    <ComposerBanner
      tone="success"
      message={message}
      onDismiss={onDismiss}
      dismissLabel={t("dismissCompactResult", "Dismiss compaction result")}
    />
  );
}
