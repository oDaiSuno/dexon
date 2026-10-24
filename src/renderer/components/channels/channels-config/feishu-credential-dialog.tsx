import { useState } from "react";
import type { FeishuDomain } from "@shared/channel-types";
import { useI18n } from "@/i18n";
import { buttonStyle, controlTextClass, inputStyle } from "./control-styles";
import { FeishuDialogError } from "./feishu-dialog-error";
import { FeishuManualForm } from "./feishu-manual-form";

export function FeishuCredentialDialog({
  busy,
  error,
  onStartScan,
  onConnect,
  onClose,
  initialMode = "scan",
}: {
  busy: boolean;
  error: string;
  onStartScan: (domain: FeishuDomain) => void;
  onConnect: (appId: string, appSecret: string, domain: FeishuDomain) => void;
  onClose: () => void;
  initialMode?: "scan" | "manual";
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"scan" | "manual">(initialMode);
  const [domain, setDomain] = useState<FeishuDomain>("feishu");
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
        data-testid="feishu-connect-dialog"
        style={{
          width: 560,
          maxWidth: "calc(100vw - 28px)",
          maxHeight: "calc(100dvh - 32px)",
          overflowY: "auto",
          border: "1px solid var(--fx-line-default)",
          borderRadius: "var(--radius-card)",
          background: "var(--fx-surface-main)",
          padding: 24,
          boxShadow: "0 14px 45px rgba(0,0,0,.25)",
        }}
      >
        <h3 style={{ margin: 0, color: "var(--fx-text-primary)", fontSize: "var(--text-title)" }}>
          {t("connectFeishu", "Connect Feishu / Lark")}
        </h3>
        <p style={{ color: "var(--fx-text-secondary)", fontSize: "var(--text-label)", lineHeight: 1.6 }}>
          {mode === "scan"
            ? t(
                "feishuScanDescription",
                "Scan to create a new bot with the official Feishu/Lark flow. Credentials stay in the Agent Host and are stored with OS encryption without entering the UI.",
              )
            : t(
                "feishuCredentialDescription",
                "Connect an existing self-built app through the official WebSocket long connection. App Secret is stored with OS encryption.",
              )}
        </p>

        <div
          role="tablist"
          aria-label={t("feishuConnectionMethod", "Connection method")}
          style={{ display: "flex", gap: 8 }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "scan"}
            data-testid="feishu-scan-tab"
            className={controlTextClass}
            style={buttonStyle(mode === "scan")}
            onClick={() => setMode("scan")}
          >
            {t("feishuScanCreate", "Scan to create (recommended)")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "manual"}
            data-testid="feishu-manual-tab"
            className={controlTextClass}
            style={buttonStyle(mode === "manual")}
            onClick={() => setMode("manual")}
          >
            {t("feishuExistingApp", "Existing app")}
          </button>
        </div>

        {mode === "scan" ? (
          <div data-testid="feishu-scan-create" style={{ marginTop: 16 }}>
            <label style={{ display: "grid", gap: 8, color: "var(--fx-text-secondary)", fontSize: "var(--text-meta)" }}>
              {t("feishuTenantRegion", "Account region")}
              <select
                autoFocus
                className={controlTextClass}
                style={inputStyle}
                value={domain}
                onChange={(event) => setDomain(event.target.value as FeishuDomain)}
              >
                <option value="feishu">{t("feishuChina", "Feishu (China)")}</option>
                <option value="lark">Lark</option>
              </select>
            </label>
            <div
              style={{
                marginTop: 12,
                border: "1px solid var(--fx-line-default)",
                borderRadius: "var(--radius-card)",
                background: "var(--fx-surface-raised)",
                padding: "12px 12px",
                color: "var(--fx-text-secondary)",
                fontSize: "var(--text-meta)",
                lineHeight: 1.65,
              }}
            >
              <strong style={{ color: "var(--fx-text-primary)" }}>
                {t("feishuScanCreatesNew", "Creates a new bot")}
              </strong>
              <div>
                {t(
                  "feishuScanSecurityDefaults",
                  "The scanning user is the only allowed DM sender by default. Groups, commands, and Agent tools remain disabled until you enable them.",
                )}
              </div>
              <div style={{ marginTop: 8 }}>
                {t(
                  "feishuScanExistingHint",
                  "Already have an app? Use the Existing app tab instead; scanning never reads an existing App Secret.",
                )}
              </div>
            </div>
            <FeishuDialogError error={error} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button
                type="button"
                disabled={busy}
                className={controlTextClass}
                style={buttonStyle()}
                onClick={onClose}
              >
                {t("cancel", "Cancel")}
              </button>
              <button
                type="button"
                data-testid="start-feishu-scan"
                disabled={busy}
                className={controlTextClass}
                style={buttonStyle(true)}
                onClick={() => onStartScan(domain)}
              >
                {busy ? t("creatingQrCode", "Creating QR code…") : t("createQrCode", "Create QR code")}
              </button>
            </div>
          </div>
        ) : (
          <FeishuManualForm
            busy={busy}
            error={error}
            domain={domain}
            setDomain={setDomain}
            onConnect={onConnect}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}
