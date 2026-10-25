import { useI18n } from "@/i18n";
import { formatNumber } from "@/lib/locale-format";
import { ArrowRightIcon } from "../chat-input/icons";
import { SessionNamingGlyph } from "../session-sidebar/session-relation-glyphs";

export function SessionNamingPreview() {
  const { t, language } = useI18n();
  const title = t("sessionNamingPreviewTitle", "Sidebar session menu");

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "16px 20px",
        background: "var(--fx-surface-inset)",
        borderBottom: "1px solid var(--fx-line-default)",
      }}
    >
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "grid",
          gap: 4,
          padding: "10px 12px",
          background: "var(--fx-surface-raised)",
          border: "1px solid var(--fx-line-default)",
          borderRadius: "var(--radius-card)",
        }}
      >
        <span className="type-meta-default" style={{ color: "var(--fx-text-tertiary)" }}>
          {t("sessionNamingPreviewFirstMessage", "First message")}
        </span>
        <p className="type-label-default" style={{ margin: 0, color: "var(--fx-text-body)" }}>
          {t(
            "sessionNamingPreviewMessage",
            "Sidebar sessions can only be opened right now. I want a right-click menu to rename and delete them, and ideally have AI pick a new name for me.",
          )}
        </p>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 4,
          flexShrink: 0,
          color: "var(--fx-text-tertiary)",
        }}
      >
        <ArrowRightIcon size={16} />
        <span className="type-mono-meta">{"≈ 1s"}</span>
      </div>
      <div style={{ width: 232, flexShrink: 0, display: "grid", gap: 6 }}>
        <span className="type-meta-default" style={{ color: "var(--fx-text-tertiary)" }}>
          {t("sessionNamingPreviewResult", "Shown in the sidebar as")}
        </span>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            height: 30,
            padding: "0 10px 0 8px",
            background: "var(--fx-accent-blue-soft)",
            border: "1px solid var(--fx-accent-blue-border)",
            borderRadius: "var(--radius-row)",
          }}
        >
          <span style={{ display: "flex", color: "var(--fx-accent-blue-text)" }}>
            <SessionNamingGlyph size={14} />
          </span>
          <span
            className="type-body-medium"
            style={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              color: "var(--fx-text-primary)",
            }}
          >
            {title}
          </span>
          <span className="type-mono-meta" style={{ flexShrink: 0, color: "var(--fx-accent-blue-text)" }}>
            {t("sessionNamingPreviewLength", "{count} chars").replace(
              "{count}",
              formatNumber([...title].length, language),
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
