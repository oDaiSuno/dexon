import { useI18n } from "@/i18n";
import { buttonStyle } from "./control-styles";

export function ChannelsHeader({
  busy,
  onConnectFeishu,
  onConnectTelegram,
  onConnectWeixin,
}: {
  busy: boolean;
  onConnectFeishu: () => void;
  onConnectTelegram: () => void;
  onConnectWeixin: () => void;
}) {
  const { t } = useI18n();
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
      <div>
        <h2 style={{ margin: 0, color: "var(--fx-text-primary)", fontSize: "var(--text-title)" }}>
          {t("messagingChannels", "Messaging channels")}
        </h2>
        <p
          style={{
            margin: "8px 0 0",
            color: "var(--fx-text-tertiary)",
            fontSize: "var(--text-label)",
            lineHeight: 1.6,
          }}
        >
          {t("channelsDescription", "Connect IM accounts, control access, and bind conversations to Pi sessions.")}
        </p>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 8 }}>
        <button type="button" disabled={busy} style={buttonStyle()} onClick={onConnectFeishu}>
          {t("connectFeishu", "Connect Feishu / Lark")}
        </button>
        <button type="button" disabled={busy} style={buttonStyle()} onClick={onConnectTelegram}>
          {t("connectTelegram", "Connect Telegram")}
        </button>
        <button type="button" disabled={busy} style={buttonStyle()} onClick={onConnectWeixin}>
          {t("connectWeixin", "Connect WeChat")}
        </button>
      </div>
    </div>
  );
}
