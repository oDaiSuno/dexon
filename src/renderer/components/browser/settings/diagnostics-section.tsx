import type { CSSProperties } from "react";
import { useI18n } from "@/i18n";
import { Button } from "../../form-controls";
import { SettingGroup } from "../../settings/setting-row";
import {
  ActionsRow,
  InputRow,
  NoticeRow,
  NumberRow,
  RowSpacer,
  SelectRow,
  ToggleRow,
  formatBytes,
  formatMessage,
  profileModeLabel,
  withSettings,
  type BrowserSettingsModel,
} from "./shared";

type IdentityMode = "native" | "chrome-compatible" | "custom";

export function AdvancedModeSection({ model }: { model: BrowserSettingsModel }) {
  const { t } = useI18n();
  const { state, settings, advancedEnabled, update, setState } = model;
  const advanced = settings.advancedBrowserMode;
  const edit = (patch: Partial<typeof advanced>) => setState(withSettings(state, "advancedBrowserMode", patch));
  return (
    <SettingGroup title={t("browserAdvancedMode", "Advanced Browser Mode")}>
      <ToggleRow
        label={t("browserEnableAdvancedForLaunch", "Enable Advanced Browser Mode for this launch")}
        description={t(
          "browserAdvancedModeWarning",
          "One launch-only switch enables JavaScript, three-layer browser identity, trusted humanized input, full CDP network capture, confirmed write replay, the JavaScript experience library, security-header removal, advanced Profiles, certificate bypass, and unrestricted CDP. Full Cookie values remain blocked by Gate A.",
        )}
        checked={advancedEnabled}
        onChange={(enabled) => void update({ advancedBrowserMode: { enabled } })}
      />
      <NoticeRow tone="warning">
        {t(
          "browserAdvancedRuntimeConfirmations",
          "POST/PUT/PATCH/DELETE replay and existing sensitive actions still require one local confirmation per action; these are action confirmations, not extra settings.",
        )}
      </NoticeRow>
      <SelectRow
        label={t("browserIdentityMode", "Browser identity")}
        value={advanced.identityMode}
        onChange={(value) => void update({ advancedBrowserMode: { identityMode: value as IdentityMode } })}
      >
        <option value="chrome-compatible">
          {t("browserIdentityChromeCompatible", "Chromium-compatible (recommended)")}
        </option>
        <option value="native">{t("browserIdentityNative", "Electron native")}</option>
        <option value="custom">{t("browserIdentityCustom", "Custom consistent identity")}</option>
      </SelectRow>
      {advanced.identityMode === "custom" && (
        <>
          <InputRow
            label={t("browserCustomUserAgent", "Custom User-Agent")}
            value={advanced.customUserAgentValue}
            placeholder="Mozilla/5.0 … Chrome/142.0.0.0 …"
            onChange={(customUserAgentValue) => edit({ customUserAgentValue })}
            onBlur={(customUserAgentValue) => void update({ advancedBrowserMode: { customUserAgentValue } })}
          />
          <InputRow
            label={t("browserClientHintsPlatform", "Client Hints platform")}
            value={advanced.customUserAgentPlatform}
            placeholder="macOS, Windows, Linux…"
            onChange={(customUserAgentPlatform) => edit({ customUserAgentPlatform })}
            onBlur={(customUserAgentPlatform) => void update({ advancedBrowserMode: { customUserAgentPlatform } })}
          />
          <InputRow
            label={t("browserChromiumFullVersion", "Chromium full version")}
            value={advanced.customUserAgentFullVersion}
            placeholder="142.0.0.0"
            onChange={(customUserAgentFullVersion) => edit({ customUserAgentFullVersion })}
            onBlur={(customUserAgentFullVersion) =>
              void update({ advancedBrowserMode: { customUserAgentFullVersion } })
            }
          />
        </>
      )}
      <InputRow
        label={t("browserCertificateDomains", "Certificate bypass domains (comma separated)")}
        value={advanced.certificateBypassDomains.join(", ")}
        onChange={(value) => edit({ certificateBypassDomains: value.split(",").map((entry) => entry.trim()) })}
        onBlur={(value) =>
          void update({
            advancedBrowserMode: {
              certificateBypassDomains: value
                .split(",")
                .map((entry) => entry.trim())
                .filter(Boolean),
            },
          })
        }
      />
      <NumberRow
        label={t("browserNetworkRequestCapacity", "Captured requests per tab")}
        fields={[
          {
            label: t("browserNetworkRequestCapacity", "Captured requests per tab"),
            value: advanced.maxRequestsPerTab,
            min: 50,
            max: 5000,
            onCommit: (maxRequestsPerTab) => void update({ advancedBrowserMode: { maxRequestsPerTab } }),
          },
        ]}
      />
      <NumberRow
        label={t("browserNetworkBodyCapacity", "Captured body capacity per tab (MiB)")}
        fields={[
          {
            label: t("browserNetworkBodyCapacity", "Captured body capacity per tab (MiB)"),
            value: Math.round(advanced.maxBodyBytesPerTab / (1024 * 1024)),
            min: 1,
            max: 256,
            onCommit: (value) => void update({ advancedBrowserMode: { maxBodyBytesPerTab: value * 1024 * 1024 } }),
          },
        ]}
      />
      <NumberRow
        label={t("browserSnippetCapacity", "JavaScript experiences per host")}
        fields={[
          {
            label: t("browserSnippetCapacity", "JavaScript experiences per host"),
            value: advanced.maxPerHost,
            min: 5,
            max: 200,
            onCommit: (maxPerHost) => void update({ advancedBrowserMode: { maxPerHost } }),
          },
        ]}
      />
    </SettingGroup>
  );
}

export function DiagnosticsSection({ model }: { model: BrowserSettingsModel }) {
  const { t } = useI18n();
  const { state } = model;
  const diagnostics = state.diagnostics;
  const count = (template: string, value: number) => formatMessage(template, { count: value });
  const facts = [
    `Electron ${diagnostics.electronVersion}`,
    `Chromium ${diagnostics.chromiumVersion}`,
    count(t("browserTabsCount", "{count} tabs"), diagnostics.activeTabCount),
    count(t("browserCdpConnections", "{count} CDP connections"), diagnostics.attachedDebuggerCount),
    count(t("browserCrashedTabs", "{count} crashed tabs"), diagnostics.crashedTabCount),
    count(t("browserAdvancedTabs", "{count} advanced tabs"), diagnostics.advancedTabCount),
    count(t("browserCapturedRequests", "{count} captured requests"), diagnostics.capturedRequestCount),
    count(t("browserJavascriptExperiences", "{count} JavaScript experiences"), diagnostics.snippetCount),
    count(t("browserRendererProcesses", "{count} renderer processes"), diagnostics.rendererProcessCount),
    formatMessage(t("browserRendererWorkingSet", "Renderer working set {size}"), {
      size: formatBytes(diagnostics.rendererWorkingSetBytes),
    }),
  ];
  const reset = () => {
    if (!window.confirm(t("browserResetConfirm", "Reset Browser settings and revoke all Browser capabilities?")))
      return;
    void window.piBridge.browserReset().then(model.setState).catch(model.report);
  };
  return (
    <SettingGroup title={t("browserDiagnosticsReset", "Diagnostics and reset")}>
      <ActionsRow>
        <div className="type-label-default" style={factsStyle}>
          {facts.map((fact) => (
            <span key={fact}>{fact}</span>
          ))}
        </div>
      </ActionsRow>
      <NoticeRow>
        {diagnostics.profilePartitions
          .map((profile) => `${profileModeLabel(t, profile.mode)}: ${profile.partition}`)
          .join(" · ")}
      </NoticeRow>
      <NoticeRow>
        {t(
          "browserWorkflowGuardScope",
          "Workflow guard blocks obvious Browser route bypasses; it is not an OS network sandbox.",
        )}
      </NoticeRow>
      <ActionsRow>
        <Button onClick={() => void window.piBridge.exportDiagnostics()}>
          {t("browserExportDiagnostics", "Export redacted diagnostics")}
        </Button>
        <Button onClick={() => model.run(() => window.piBridge.browserCloseAllTabs())}>
          {t("browserCloseAllTabs", "Close all tabs")}
        </Button>
        <RowSpacer />
        <Button
          variant="danger"
          onClick={() =>
            model.run(() =>
              Promise.all(state.profiles.map((profile) => window.piBridge.browserClearProfileData(profile.id, "all"))),
            )
          }
        >
          {t("browserClearAllData", "Clear all browser data")}
        </Button>
        <Button variant="danger" onClick={reset}>
          {t("browserReset", "Reset Browser")}
        </Button>
      </ActionsRow>
    </SettingGroup>
  );
}

const factsStyle: CSSProperties = {
  flex: 1,
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: "var(--space-2) var(--space-3)",
  color: "var(--fx-text-secondary)",
};
