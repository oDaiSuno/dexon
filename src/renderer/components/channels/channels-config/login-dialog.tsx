import { QRCodeSVG } from "@rc-component/qrcode";
import { useEffect, useState } from "react";
import type { ChannelLoginEvent } from "@shared/channel-types";
import { useI18n } from "@/i18n";
import { buttonStyle, inputStyle } from "./control-styles";

export function LoginDialog({
  event,
  code,
  setCode,
  onSubmitCode,
  onRetry,
  onClose,
}: {
  event: ChannelLoginEvent;
  code: string;
  setCode: (value: string) => void;
  onSubmitCode: () => void;
  onRetry?: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const terminal = ["confirmed", "already_connected", "expired", "error", "cancelled"].includes(event.phase);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (!event.expiresAt || terminal) return;
    const timer = setInterval(() => setClock(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [event.expiresAt, terminal]);
  const remainingSeconds = event.expiresAt ? Math.max(0, Math.ceil((event.expiresAt - clock) / 1_000)) : undefined;
  const isFeishu = event.channel === "feishu";
  const retryable =
    event.phase === "expired" || event.phase === "cancelled" || (event.phase === "error" && !event.accountId);
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
        data-testid={`channel-login-dialog-${event.channel}`}
        style={{
          width: 390,
          maxWidth: "calc(100vw - 28px)",
          border: "1px solid var(--fx-line-default)",
          borderRadius: "var(--radius-card)",
          background: "var(--fx-surface-main)",
          padding: 24,
          textAlign: "center",
          boxShadow: "0 14px 45px rgba(0,0,0,.25)",
        }}
      >
        <h3 style={{ margin: 0, color: "var(--fx-text-primary)", fontSize: "var(--text-title)" }}>
          {isFeishu
            ? t("feishuScanCreateTitle", "Scan to create Feishu / Lark bot")
            : t("connectWeixin", "Connect WeChat")}
        </h3>
        {event.qrContent && !terminal && (
          <div
            style={{
              width: 236,
              height: 236,
              padding: 12,
              background: "white",
              borderRadius: "var(--radius-card)",
              margin: "20px auto 12px",
            }}
          >
            <QRCodeSVG
              value={event.qrContent}
              size={216}
              level="M"
              marginSize={2}
              title={
                isFeishu
                  ? t("feishuCreateQrCode", "Feishu / Lark app creation QR code")
                  : t("weixinLoginQrCode", "WeChat login QR code")
              }
            />
          </div>
        )}
        {remainingSeconds !== undefined && !terminal && (
          <div style={{ color: "var(--fx-text-tertiary)", fontSize: "var(--text-meta)", marginTop: 8 }}>
            {t("qrCodeExpiresIn", "QR code expires in")} {remainingSeconds}s
          </div>
        )}
        <p
          style={{
            color: event.phase === "error" ? "var(--fx-status-danger)" : "var(--fx-text-secondary)",
            fontSize: "var(--text-label)",
            lineHeight: 1.6,
          }}
        >
          {event.message}
        </p>
        {event.phase === "verification_required" && (
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <input
              autoFocus
              style={inputStyle}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder={t("verificationNumber", "Verification number")}
            />
            <button type="button" style={buttonStyle(true)} onClick={onSubmitCode}>
              {t("submit", "Submit")}
            </button>
          </div>
        )}
        {(event.phase === "waiting" || event.phase === "scanned") && (
          <div style={{ color: "var(--fx-text-tertiary)", fontSize: "var(--text-meta)" }}>
            {isFeishu
              ? t("waitingForFeishuAuthorization", "Waiting securely for Feishu / Lark authorization…")
              : t("pollingSecurely", "Polling securely…")}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 16 }}>
          {retryable && onRetry && (
            <button type="button" style={buttonStyle(true)} onClick={onRetry}>
              {t("regenerateQrCode", "Generate a new QR code")}
            </button>
          )}
          <button type="button" style={buttonStyle()} onClick={onClose}>
            {terminal ? t("close", "Close") : t("cancel", "Cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
