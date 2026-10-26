import { useState } from "react";
import { useI18n } from "@/i18n";
import { buttonStyle, controlTextClass, inputStyle } from "./control-styles";

export function TelegramTokenDialog({
  busy,
  error,
  onConnect,
  onClose,
}: {
  busy: boolean;
  error: string;
  onConnect: (token: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [token, setToken] = useState("");
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1200,
        background: "rgba(0,0,0,.45)",
        display: "grid",
        placeItems: "center",
      }}
    >
      <div
        style={{
          width: 430,
          maxWidth: "calc(100vw - 28px)",
          border: "1px solid var(--fx-line-default)",
          borderRadius: "var(--radius-card)",
          background: "var(--fx-surface-main)",
          padding: 24,
          boxShadow: "0 14px 45px rgba(0,0,0,.25)",
        }}
      >
        <h3 style={{ margin: 0, color: "var(--fx-text-primary)", fontSize: "var(--text-title)" }}>
          {t("connectTelegram", "Connect Telegram")}
        </h3>
        <p style={{ color: "var(--fx-text-secondary)", fontSize: "var(--text-label)", lineHeight: 1.6 }}>
          {t(
            "telegramTokenDescription",
            "Create a bot with @BotFather, paste its token here, then Pi Desktop will verify it with getMe and store it using OS encryption.",
          )}
        </p>
        <input
          autoFocus
          type="password"
          autoComplete="off"
          className={controlTextClass}
          style={inputStyle}
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder={t("telegramBotToken", "BotFather token")}
        />
        {error && (
          <div
            role="alert"
            data-testid="telegram-connect-error"
            style={{
              marginTop: 12,
              color: "var(--fx-status-danger)",
              fontSize: "var(--text-meta)",
              lineHeight: 1.5,
              overflowWrap: "anywhere",
            }}
          >
            {error}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button type="button" disabled={busy} className={controlTextClass} style={buttonStyle()} onClick={onClose}>
            {t("cancel", "Cancel")}
          </button>
          <button
            type="button"
            disabled={busy || !token.trim()}
            className={controlTextClass}
            style={buttonStyle(true)}
            onClick={() => onConnect(token.trim())}
          >
            {busy ? t("testingConnection", "Testing…") : t("saveAndConnect", "Save and connect")}
          </button>
        </div>
      </div>
    </div>
  );
}
