import { useState, type CSSProperties } from "react";
import { useI18n } from "@/i18n";
import { Button } from "../../form-controls";
import { SettingGroup } from "../../settings/setting-row";
import { ActionsRow, InputRow, RowSpacer, SelectRow, withSettings, type BrowserSettingsModel } from "./shared";

export function DownloadsProxySection({ model, label }: { model: BrowserSettingsModel; label: string }) {
  return (
    <div role="group" aria-label={label} style={pairStyle}>
      <DownloadsGroup model={model} />
      <ProxyGroup model={model} />
    </div>
  );
}

function DownloadsGroup({ model }: { model: BrowserSettingsModel }) {
  const { t } = useI18n();
  const { settings, update } = model;
  const chooseDirectory = (mode?: "allow-to-directory") =>
    void window.piBridge.selectDirectory().then((directory) => {
      if (directory) void update({ downloads: mode ? { mode, directory } : { directory } });
    });
  return (
    <SettingGroup title={t("browserDownloads", "Downloads")}>
      <SelectRow
        label={t("browserDownloadPolicy", "Download policy")}
        description={t("browserDownloadPolicyDescription", "What happens when a page starts a download.")}
        value={settings.downloads.mode}
        onChange={(value) => {
          const mode = value as "ask" | "deny" | "allow-to-directory";
          if (mode === "allow-to-directory") chooseDirectory(mode);
          else void update({ downloads: { mode } });
        }}
      >
        <option value="ask">{t("browserAskEveryTime", "Ask every time")}</option>
        <option value="deny">{t("browserDeny", "Deny")}</option>
        <option value="allow-to-directory">{t("browserAllowApprovedDirectory", "Allow to approved directory")}</option>
      </SelectRow>
      {settings.downloads.mode === "allow-to-directory" && (
        <InputRow
          label={t("browserApprovedDirectory", "Approved directory")}
          value={settings.downloads.directory ?? ""}
          readOnly
          width={160}
          trailing={<Button onClick={() => chooseDirectory()}>{t("browserChoose", "Choose…")}</Button>}
        />
      )}
    </SettingGroup>
  );
}

function ProxyGroup({ model }: { model: BrowserSettingsModel }) {
  const { t } = useI18n();
  const { state, settings, update, setState } = model;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const stored = Boolean(settings.proxy.credentialSecretRef);
  return (
    <SettingGroup title={t("browserProxy", "Proxy")}>
      <SelectRow
        label={t("browserProxyMode", "Proxy mode")}
        description={t("browserProxyModeDescription", "The network proxy used for Browser traffic.")}
        value={settings.proxy.mode}
        onChange={(value) => {
          const mode = value as "system" | "direct" | "custom";
          void update({
            proxy: {
              mode,
              ...(mode === "custom" && !settings.proxy.proxyRules ? { proxyRules: "http://127.0.0.1:8080" } : {}),
            },
          });
        }}
      >
        <option value="system">{t("browserProxySystem", "System")}</option>
        <option value="direct">{t("browserProxyDirect", "Direct")}</option>
        <option value="custom">{t("browserProxyCustom", "Custom")}</option>
      </SelectRow>
      {settings.proxy.mode === "custom" && (
        <>
          <InputRow
            label={t("browserProxyRules", "Proxy rules")}
            value={settings.proxy.proxyRules ?? ""}
            width={160}
            onChange={(proxyRules) => setState(withSettings(state, "proxy", { proxyRules }))}
            onBlur={(proxyRules) => void update({ proxy: { proxyRules } })}
          />
          <InputRow
            label={t("browserBypassRules", "Bypass rules")}
            value={settings.proxy.proxyBypassRules ?? ""}
            width={160}
            onChange={(proxyBypassRules) => setState(withSettings(state, "proxy", { proxyBypassRules }))}
            onBlur={(proxyBypassRules) => void update({ proxy: { proxyBypassRules } })}
          />
          <InputRow
            label={t("browserProxyUsername", "Proxy username")}
            value={username}
            width={160}
            autoComplete="off"
            onChange={setUsername}
          />
          <InputRow
            label={t("browserProxyPassword", "Proxy password")}
            description={
              stored
                ? t("browserCredentialsStored", "Credentials are stored with Electron safeStorage.")
                : t("browserNoCredentials", "No credentials stored.")
            }
            value={password}
            type="password"
            width={160}
            autoComplete="new-password"
            onChange={setPassword}
          />
          <ActionsRow>
            <RowSpacer />
            {stored && (
              <Button variant="ghost" onClick={() => model.run(() => window.piBridge.browserSetProxyCredentials(null))}>
                {t("browserRemoveCredentials", "Remove stored credentials")}
              </Button>
            )}
            <Button
              disabled={!username || !password}
              onClick={() =>
                model.run(async () => {
                  await window.piBridge.browserSetProxyCredentials({ username, password });
                  setUsername("");
                  setPassword("");
                })
              }
            >
              {t("browserStoreCredentials", "Store credentials securely")}
            </Button>
          </ActionsRow>
        </>
      )}
    </SettingGroup>
  );
}

const pairStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
  gap: "var(--space-4)",
  alignItems: "start",
};
