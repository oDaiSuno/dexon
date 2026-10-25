import { useState } from "react";
import { useI18n } from "@/i18n";
import { isBrowserSearchTemplate, type BrowserSearchEngine } from "@contract/browser-search";
import { SettingGroup } from "../../settings/setting-row";
import { NumberPillsRow, type NumberPillSpec } from "./number-pills";
import {
  InputRow,
  SelectRow,
  ToggleRow,
  formatMessage,
  profileModeLabel,
  withSettings,
  type BrowserSettingsModel,
} from "./shared";

export function BasicsSection({ model }: { model: BrowserSettingsModel }) {
  const { t } = useI18n();
  const { state, settings, update, setState } = model;
  const milliseconds = t("browserMillisecondsUnit", "ms");
  const invalidMessage = (field: NumberPillSpec) =>
    formatMessage(t("browserNumberOutOfRange", "{label}: enter a whole number from {min} to {max}."), {
      label: field.label,
      min: field.min,
      max: field.max,
    });
  return (
    <SettingGroup title={t("browserBasics", "Basics")}>
      <ToggleRow
        label={t("browserRestoreTabs", "Restore safe tabs on startup")}
        description={t(
          "browserRestoreTabsDescription",
          "Only regular tabs without sensitive information are restored.",
        )}
        checked={settings.panel.restoreTabs}
        onChange={(restoreTabs) => void update({ panel: { restoreTabs } })}
      />
      <ToggleRow
        label={t("browserOpenPanelOnUse", "Open Browser panel when Agent starts browsing")}
        description={t(
          "browserOpenPanelOnUseDescription",
          "Expands the Browser panel when the Agent opens a page, so you can watch it live.",
        )}
        checked={settings.panel.openOnAgentUse}
        onChange={(openOnAgentUse) => void update({ panel: { openOnAgentUse } })}
      />
      <InputRow
        label={t("browserHomepage", "Homepage")}
        description={t("browserHomepageDescription", "The address opened when the Browser starts and for new tabs.")}
        value={settings.navigation.homepage}
        onChange={(homepage) => setState(withSettings(state, "navigation", { homepage }))}
        onBlur={(homepage) => void update({ navigation: { homepage } })}
      />
      <SearchEngineRows model={model} />
      <SelectRow
        label={t("browserDefaultProfile", "Profile for new tabs")}
        description={t(
          "browserDefaultProfileDescription",
          "Decides where new tabs keep their sign-in state and site data.",
        )}
        value={settings.panel.defaultProfileId}
        onChange={(defaultProfileId) => void update({ panel: { defaultProfileId } })}
      >
        {state.profiles
          .filter((profile) => profile.mode !== "unsafe")
          .map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name} · {profileModeLabel(t, profile.mode)}
            </option>
          ))}
      </SelectRow>
      <NumberPillsRow
        label={t("browserTabLimits", "Tab limits")}
        description={t("browserTabLimitsDescription", "How many tabs can be open in total and per Agent session.")}
        invalidMessage={invalidMessage}
        fields={[
          {
            label: t("browserMaximumTabs", "Global"),
            value: settings.navigation.maxTabs,
            min: 1,
            max: 50,
            onCommit: (maxTabs) => void update({ navigation: { maxTabs } }),
          },
          {
            label: t("browserTabsPerAgent", "Per session"),
            value: settings.navigation.maxTabsPerSession,
            min: 1,
            max: 20,
            onCommit: (maxTabsPerSession) => void update({ navigation: { maxTabsPerSession } }),
          },
        ]}
      />
      <NumberPillsRow
        label={t("browserTimeouts", "Timeouts")}
        description={t("browserTimeoutsDescription", "The longest wait for page navigation and for a single action.")}
        invalidMessage={invalidMessage}
        fields={[
          {
            label: t("browserNavigationTimeout", "Navigation"),
            value: settings.navigation.navigationTimeoutMs,
            min: 1000,
            max: 300000,
            unit: milliseconds,
            onCommit: (navigationTimeoutMs) => void update({ navigation: { navigationTimeoutMs } }),
          },
          {
            label: t("browserActionTimeout", "Action"),
            value: settings.navigation.actionTimeoutMs,
            min: 250,
            max: 120000,
            unit: milliseconds,
            onCommit: (actionTimeoutMs) => void update({ navigation: { actionTimeoutMs } }),
          },
        ]}
      />
    </SettingGroup>
  );
}

function SearchEngineRows({ model }: { model: BrowserSettingsModel }) {
  const { t } = useI18n();
  const [pendingCustom, setPendingCustom] = useState(false);
  const navigation = model.settings.navigation;
  const selected = pendingCustom ? "custom" : navigation.searchEngine;
  return (
    <>
      <SelectRow
        label={t("browserSearchEngine", "Address bar search engine")}
        description={t(
          "browserSearchEngineDescription",
          "Used when what you type in the address bar isn't a web address.",
        )}
        value={selected}
        onChange={(value) => {
          if (value === "custom" && !isBrowserSearchTemplate(navigation.customSearchTemplate)) {
            setPendingCustom(true);
            return;
          }
          setPendingCustom(false);
          void model.update({ navigation: { searchEngine: value as BrowserSearchEngine } });
        }}
      >
        <option value="bing">{t("browserSearchEngineBing", "Bing")}</option>
        <option value="google">{t("browserSearchEngineGoogle", "Google")}</option>
        <option value="duckduckgo">{t("browserSearchEngineDuckDuckGo", "DuckDuckGo")}</option>
        <option value="baidu">{t("browserSearchEngineBaidu", "Baidu")}</option>
        <option value="custom">{t("browserSearchEngineCustom", "Custom")}</option>
      </SelectRow>
      {selected === "custom" && (
        <InputRow
          label={t("browserCustomSearchTemplate", "Custom search address")}
          description={t(
            "browserCustomSearchTemplateDescription",
            "An https address with {query} where the search words go.",
          )}
          width={320}
          value={navigation.customSearchTemplate}
          onChange={(customSearchTemplate) =>
            model.setState(withSettings(model.state, "navigation", { customSearchTemplate }))
          }
          onBlur={(value) => {
            const template = value.trim();
            if (!isBrowserSearchTemplate(template)) {
              model.setError(t("browserCustomSearchTemplateInvalid", "Enter an https address that contains {query}."));
              return;
            }
            setPendingCustom(false);
            void model.update({ navigation: { searchEngine: "custom", customSearchTemplate: template } });
          }}
        />
      )}
    </>
  );
}
