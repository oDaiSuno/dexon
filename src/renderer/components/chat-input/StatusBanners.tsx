import type { ReactNode } from "react";
import { useI18n } from "@/i18n";
import type { QueuedMessages, CompactResultInfo } from "@/hooks/useAgentSession";
import { segmentByAttachmentTokens } from "@shared/attachment-tokens";
import { AttachmentChip } from "../messages/message-chips";
import { CircleAlertIcon, CircleCheckIcon, CloseIcon, Icon, RecallIcon, TriangleAlertIcon } from "./icons";
import { formatTokenCount } from "./SessionControls";

function ListEndIcon({ size = 14 }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M16 12H3" />
      <path d="M16 6H3" />
      <path d="M10 18H3" />
      <path d="M21 6v10a2 2 0 0 1-2 2h-5" />
      <path d="m16 16-2 2 2 2" />
    </Icon>
  );
}

function SteerIcon({ size = 13 }: { size?: number }) {
  return (
    <Icon size={size} strokeWidth={2}>
      <path d="m15 10 5 5-5 5" />
      <path d="M4 4v7a4 4 0 0 0 4 4h12" />
    </Icon>
  );
}

function FollowUpIcon({ size = 13 }: { size?: number }) {
  return (
    <Icon size={size} strokeWidth={2}>
      <path d="M12 17V3" />
      <path d="m6 11 6 6 6-6" />
      <path d="M19 21H5" />
    </Icon>
  );
}

function QueuedMessageRow({ kind, text }: { kind: "steer" | "follow-up"; text: string }) {
  const { t } = useI18n();
  const isSteer = kind === "steer";
  return (
    <div className="queue-tray-row" title={text}>
      <span
        className="queue-tray-kind type-label-medium"
        style={{ color: isSteer ? "var(--fx-status-warning-text)" : "var(--fx-text-secondary)" }}
      >
        {isSteer ? <SteerIcon /> : <FollowUpIcon />}
        {isSteer ? t("steer", "Steer") : t("followUp", "Follow-up")}
      </span>
      <div className="queue-tray-message type-body-default">
        {segmentByAttachmentTokens(text).map((segment, index) =>
          segment.type === "text" ? (
            <span key={index} className="queue-tray-message-text">
              {segment.text}
            </span>
          ) : (
            <AttachmentChip key={index} path={segment.token.path} previewUrl={null} />
          ),
        )}
      </div>
      <span className="queue-tray-when type-meta-default">
        {isSteer ? t("queuedTimingNextStep", "Before next step") : t("queuedTimingAfterDone", "When done")}
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
    <div className="queue-tray">
      <div className="queue-tray-header">
        <span className="queue-tray-mark">
          <ListEndIcon />
        </span>
        <span className="queue-tray-title type-label-medium">{t("queued", "Queued")}</span>
        <span className="queue-tray-count type-mono-meta">{total}</span>
        <span className="queue-tray-dot" aria-hidden="true" />
        <span className="queue-tray-hint type-label-default">
          {t("queuedHint", "Delivered in order; recall to rewrite and resend")}
        </span>
        {onRecallQueue && (
          <button
            type="button"
            className="queue-tray-recall type-label-medium"
            onClick={onRecallQueue}
            aria-label={t(
              "recallQueueDescription",
              "Remove all queued messages and put them back into the input box for editing",
            )}
          >
            <span className="queue-tray-recall-glyph">
              <RecallIcon size={13} />
            </span>
            {t("recallToInput", "Recall to input")}
          </button>
        )}
      </div>
      <div className="queue-tray-list">
        {queuedMessages.steering.map((text, i) => (
          <QueuedMessageRow key={`steer-${i}`} kind="steer" text={text} />
        ))}
        {queuedMessages.followUp.map((text, i) => (
          <QueuedMessageRow key={`followup-${i}`} kind="follow-up" text={text} />
        ))}
      </div>
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
