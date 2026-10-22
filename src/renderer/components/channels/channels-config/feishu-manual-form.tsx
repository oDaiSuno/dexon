import { useState } from "react";
import type { FeishuDomain } from "@shared/channel-types";
import { copyText } from "@/lib/clipboard";
import { useI18n } from "@/i18n";
import { FEISHU_PERMISSION_IMPORT_JSON } from "./constants";
import { buttonStyle, inputStyle } from "./control-styles";
import { FeishuDialogError } from "./feishu-dialog-error";

export function FeishuManualForm({
  busy,
  error,
  domain,
  setDomain,
  onConnect,
  onClose,
}: {
  busy: boolean;
  error: string;
  domain: FeishuDomain;
  setDomain: (domain: FeishuDomain) => void;
  onConnect: (appId: string, appSecret: string, domain: FeishuDomain) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [permissionCopyState, setPermissionCopyState] = useState<"idle" | "copied" | "error">("idle");
  const docsBase = domain === "lark" ? "https://open.larksuite.com" : "https://open.feishu.cn";
  const copyPermissionJson = async () => {
    try {
      await copyText(FEISHU_PERMISSION_IMPORT_JSON);
      setPermissionCopyState("copied");
    } catch {
      setPermissionCopyState("error");
    }
  };
  return (
    <div data-testid="feishu-existing-app" style={{ marginTop: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 150px", gap: 8 }}>
        <input
          autoFocus
          autoComplete="off"
          style={inputStyle}
          value={appId}
          onChange={(event) => setAppId(event.target.value)}
          placeholder={t("feishuAppId", "App ID (cli_…)")}
        />
        <select style={inputStyle} value={domain} onChange={(event) => setDomain(event.target.value as FeishuDomain)}>
          <option value="feishu">{t("feishuChina", "Feishu (China)")}</option>
          <option value="lark">Lark</option>
        </select>
      </div>
      <input
        type="password"
        autoComplete="off"
        style={{ ...inputStyle, marginTop: 8 }}
        value={appSecret}
        onChange={(event) => setAppSecret(event.target.value)}
        placeholder={t("feishuAppSecret", "App Secret")}
      />

      <div
        style={{
          marginTop: 16,
          border: "1px solid var(--fx-line-default)",
          borderRadius: "var(--radius-card)",
          background: "var(--fx-surface-raised)",
          padding: "12px 12px",
          color: "var(--fx-text-secondary)",
          fontSize: "var(--text-meta)",
          lineHeight: 1.6,
        }}
      >
        <div style={{ color: "var(--fx-text-primary)", fontWeight: 700 }}>
          {t("feishuSetupChecklist", "Quick setup")}
        </div>
        <ol style={{ margin: "8px 0 0", paddingLeft: 20 }}>
          <li>{t("feishuSetupBot", "Create an enterprise self-built app and enable Bot capability.")}</li>
          <li>
            {t(
              "feishuSetupPermissionImport",
              "Copy the permission JSON below, then paste it under Permissions & Scopes → Batch import/export scopes and apply for access.",
            )}
          </li>
          <li>
            {t(
              "feishuSetupConnection",
              "Under Events and Callbacks, select long connection mode and subscribe to im.message.receive_v1 and application.bot.menu_v6.",
            )}
          </li>
          <li>
            {t(
              "feishuSetupMenu",
              "Optional native menu: enable commands in this account's settings, then add event actions with keys pi_help, pi_status, pi_new, pi_compact, and pi_reload under Bot → Custom menu.",
            )}
          </li>
          <li>
            {t(
              "feishuSetupPublish",
              "Publish a new app version, configure availability, and add the bot to each allowed group.",
            )}
          </li>
        </ol>
        <pre
          data-testid="feishu-permission-json"
          style={{
            margin: "8px 0 0",
            maxHeight: 176,
            overflow: "auto",
            border: "1px solid var(--fx-line-default)",
            borderRadius: "var(--radius-control)",
            background: "var(--fx-surface-main)",
            color: "var(--fx-text-secondary)",
            padding: "8px 12px",
            fontSize: "var(--text-micro)",
            lineHeight: 1.45,
            whiteSpace: "pre",
            userSelect: "text",
          }}
        >
          {FEISHU_PERMISSION_IMPORT_JSON}
        </pre>
        {permissionCopyState === "error" && (
          <div role="alert" style={{ marginTop: 8, color: "var(--fx-status-danger)" }}>
            {t("feishuPermissionCopyFailed", "Copy failed. Select and copy the JSON above manually.")}
          </div>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
          <button
            type="button"
            data-testid="copy-feishu-permission-json"
            style={buttonStyle(true)}
            onClick={() => void copyPermissionJson()}
          >
            {permissionCopyState === "copied"
              ? t("feishuPermissionJsonCopied", "Permission JSON copied")
              : t("copyFeishuPermissionJson", "Copy permission JSON")}
          </button>
          <button
            type="button"
            style={buttonStyle()}
            onClick={() => void window.piBridge.openExternal(`${docsBase}/app`)}
          >
            {t("openDeveloperConsole", "Open developer console")}
          </button>
        </div>
      </div>

      <FeishuDialogError error={error} />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <button type="button" disabled={busy} style={buttonStyle()} onClick={onClose}>
          {t("cancel", "Cancel")}
        </button>
        <button
          type="button"
          disabled={busy || !appId.trim() || !appSecret.trim()}
          style={buttonStyle(true)}
          onClick={() => onConnect(appId.trim(), appSecret.trim(), domain)}
        >
          {busy ? t("testingConnection", "Testing…") : t("saveAndConnect", "Save and connect")}
        </button>
      </div>
    </div>
  );
}
