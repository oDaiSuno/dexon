import { useI18n } from "@/i18n";
import { InputRow, NumberRow, SelectRow, withSettings, type BrowserSettingsModel } from "./shared";

type IdentityMode = "native" | "chrome-compatible" | "custom";

export function AdvancedModeFields({ model }: { model: BrowserSettingsModel }) {
  const { t } = useI18n();
  const { state, settings, update, setState } = model;
  const advanced = settings.advancedBrowserMode;
  const edit = (patch: Partial<typeof advanced>) => setState(withSettings(state, "advancedBrowserMode", patch));
  return (
    <>
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
    </>
  );
}
