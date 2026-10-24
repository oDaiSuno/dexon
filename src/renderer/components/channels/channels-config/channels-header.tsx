import { useI18n } from "@/i18n";
import { Badge } from "../../form-controls";
import { SmartphoneIcon } from "./channel-icons";

export function ChannelsHeader() {
  const { t } = useI18n();
  return (
    <header style={{ display: "flex", alignItems: "center", gap: 16, width: "100%" }}>
      <span
        aria-hidden="true"
        style={{
          width: 48,
          height: 48,
          flexShrink: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          border: "1px solid var(--fx-line-default)",
          borderRadius: "var(--radius-plugin-tile)",
          background: "var(--fx-surface-raised)",
          color: "var(--fx-text-primary)",
        }}
      >
        <SmartphoneIcon />
      </span>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h1 className="type-title-page" style={{ margin: 0, color: "var(--fx-text-primary)" }}>
            {t("channels", "Remote chat")}
          </h1>
          <Badge tone="neutral">{t("builtInPlugin", "Built-in plugin")}</Badge>
        </div>
        <p className="type-body-large" style={{ margin: 0, color: "var(--fx-text-secondary)" }}>
          {t(
            "channelsDescription",
            "Connect Dexon sessions to WeChat, Telegram, or Feishu, and keep the Agent working from your phone while you're away.",
          )}
        </p>
      </div>
    </header>
  );
}
