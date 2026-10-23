import { useI18n } from "@/i18n";
import { BrowserIcon } from "./browser-icons";

export function BrowserStatusBar({
  agentControl,
  strictIsolation,
  advanced,
  sessionTitle,
}: {
  agentControl: boolean;
  strictIsolation: boolean;
  advanced: boolean;
  sessionTitle: string | null;
}) {
  const { t } = useI18n();
  return (
    <div
      data-browser-status
      style={{
        display: "flex",
        flexShrink: 0,
        alignItems: "center",
        gap: 8,
        height: 28,
        padding: "0 12px",
        borderTop: "1px solid var(--fx-line-default)",
        background: "var(--fx-surface-sidebar)",
        color: "var(--fx-text-tertiary)",
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          display: "flex",
          flexShrink: 0,
          alignItems: "center",
          gap: 6,
          color: agentControl ? "var(--fx-accent-blue-text)" : "var(--fx-text-tertiary)",
        }}
      >
        <BrowserIcon name={agentControl ? "bot" : "user"} size={12} strokeWidth={2} />
        <span className="type-meta-default">
          {agentControl ? t("browserAgentControl", "Agent in control") : t("browserUserControl", "You're in control")}
        </span>
      </span>
      <span className="type-meta-default" aria-hidden="true" style={{ color: "var(--fx-text-faint)" }}>
        ·
      </span>
      <span style={{ display: "flex", flexShrink: 0, alignItems: "center", gap: 5 }}>
        <BrowserIcon name="shield-check" size={12} strokeWidth={2} />
        <span className="type-meta-default">
          {strictIsolation
            ? t("browserStrictIsolation", "Strict isolation")
            : t("browserBestEffortIsolation", "Best-effort network isolation")}
        </span>
      </span>
      {advanced ? (
        <span
          style={{
            display: "flex",
            flexShrink: 0,
            alignItems: "center",
            gap: 5,
            color: "var(--fx-status-danger-text)",
          }}
        >
          <BrowserIcon name="triangle-alert" size={12} strokeWidth={2} />
          <span className="type-meta-default">{t("browserAdvancedModeBadge", "Advanced Browser Mode")}</span>
        </span>
      ) : null}
      <span style={{ flex: 1, minWidth: 0 }} />
      {sessionTitle ? (
        <span
          className="type-meta-default"
          title={sessionTitle}
          style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}
        >
          {sessionTitle}
        </span>
      ) : null}
    </div>
  );
}
