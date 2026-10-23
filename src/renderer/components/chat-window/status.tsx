import type { ReactNode } from "react";
import { type NoticeItem } from "@/hooks/useAgentSession";
import { useI18n } from "@/i18n";
import { CircleCheckIcon, CircleXIcon, CloseIcon, InfoIcon, TriangleAlertIcon } from "../chat-input/icons";
export function ExtensionStatusBar({ statuses }: { statuses: Array<{ key: string; text: string }> }) {
  if (statuses.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
      {statuses.map((status) => (
        <div
          key={status.key}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            maxWidth: "100%",
            padding: "4px 8px",
            border: "1px solid color-mix(in srgb, var(--fx-accent-blue) 24%, var(--fx-line-default))",
            borderRadius: "var(--radius-control)",
            background: "color-mix(in srgb, var(--fx-accent-blue) 7%, var(--fx-surface-main))",
            color: "var(--fx-text-secondary)",
          }}
          className="type-label-default"
        >
          <span className="type-mono-meta" style={{ color: "var(--fx-accent-blue)" }}>
            {status.key}
          </span>
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {status.text}
          </span>
        </div>
      ))}
    </div>
  );
}
export function ExtensionWidgets({ widgets }: { widgets: Array<{ key: string; lines: string[] }> }) {
  if (widgets.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
      {widgets.map((widget) => (
        <div
          key={widget.key}
          style={{
            border: "1px solid var(--fx-line-default)",
            borderRadius: "var(--radius-card)",
            background: "var(--fx-surface-raised)",
            overflow: "hidden",
          }}
        >
          <div
            className="type-mono-meta"
            style={{
              padding: "4px 8px",
              borderBottom: "1px solid var(--fx-line-default)",
              color: "var(--fx-text-tertiary)",
            }}
          >
            {widget.key}
          </div>
          <pre
            className="type-mono-code"
            style={{
              margin: 0,
              padding: "8px 8px",
              color: "var(--fx-text-secondary)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {widget.lines.join("\n")}
          </pre>
        </div>
      ))}
    </div>
  );
}
const NOTICE_ICONS: Record<NoticeItem["type"], ReactNode> = {
  info: <InfoIcon size={16} />,
  success: <CircleCheckIcon size={16} />,
  warning: <TriangleAlertIcon size={16} />,
  error: <CircleXIcon size={16} />,
};

export function NoticeShelf({
  notices,
  onDismiss,
  floating = false,
  align = "left",
}: {
  notices: NoticeItem[];
  onDismiss: (id: string) => void;
  floating?: boolean;
  align?: "left" | "right" | "center";
}) {
  const { t } = useI18n();
  if (notices.length === 0) return null;
  const alignItems = align === "right" ? "flex-end" : align === "center" ? "center" : "stretch";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems,
        marginBottom: floating ? 0 : 10,
      }}
    >
      {notices.map((notice) => (
        <div
          key={notice.id}
          className="notice-toast"
          data-tone={notice.type}
          data-exiting={notice.exiting ? "true" : undefined}
        >
          <span className="notice-toast-icon">{NOTICE_ICONS[notice.type]}</span>
          <span className="notice-toast-message type-body-default" title={notice.message}>
            {notice.message}
          </span>
          <span className="notice-toast-divider" aria-hidden="true" />
          <button
            type="button"
            className="feedback-close"
            data-size="toast"
            aria-label={t("dismissNotice", "Dismiss notification")}
            onClick={() => onDismiss(notice.id)}
          >
            <CloseIcon size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
