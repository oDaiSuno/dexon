import { useI18n } from "@/i18n";
import { SettingGroup } from "../../settings/setting-row";
import { SelectRow, ToggleRow, type BrowserSettingsModel } from "./shared";

export function NetworkSection({ model }: { model: BrowserSettingsModel }) {
  const { t } = useI18n();
  const { settings, update } = model;
  const isolation = settings.navigation.networkIsolation;
  return (
    <SettingGroup title={t("browserNetworkSecurity", "Network security")}>
      <ToggleRow
        label={t("browserAllowHttp", "Allow plain HTTP")}
        description={t(
          "browserAllowHttpDescription",
          "Only HTTPS is allowed by default. Turn this on to open unencrypted sites.",
        )}
        checked={settings.navigation.allowHttp}
        onChange={(allowHttp) => void update({ navigation: { allowHttp } })}
      />
      <ToggleRow
        label={t("browserAllowPrivateNetwork", "Allow private network and localhost")}
        description={t("browserAllowPrivateNetworkDescription", "Turn on temporarily while developing local services.")}
        checked={settings.navigation.allowPrivateNetwork}
        onChange={(allowPrivateNetwork) => void update({ navigation: { allowPrivateNetwork } })}
      />
      <SelectRow
        label={t("browserNetworkIsolation", "Network isolation")}
        description={
          isolation === "strict"
            ? t(
                "browserNetworkSummaryStrict",
                "Unavailable: strict mode requires an enforcing proxy or network sandbox.",
              )
            : t(
                "browserNetworkSummaryBestEffort",
                "Best effort: URL checks, DNS preflight, redirects, and subresources; DNS TOCTOU cannot be fully eliminated.",
              )
        }
        value={isolation}
        onChange={(value) => void update({ navigation: { networkIsolation: value as "best-effort" | "strict" } })}
      >
        <option value="best-effort">{t("browserNetworkBestEffort", "Best effort")}</option>
        <option value="strict">
          {t("browserNetworkStrict", "Strict (unavailable without enforcing network sandbox)")}
        </option>
      </SelectRow>
    </SettingGroup>
  );
}
