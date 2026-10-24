import { useI18n } from "@/i18n";
import { Button } from "../../form-controls";
import { SettingGroup } from "../../settings/setting-row";
import { BrowserIcon } from "../browser-icons";
import { AdvancedModeFields } from "./advanced-mode-fields";
import { ActionsRow, RowSpacer, ToggleRow, type BrowserSettingsModel } from "./shared";

const MEBIBYTE = 1024 * 1024;

export function DiagnosticsSection({ model }: { model: BrowserSettingsModel }) {
  const { language, t } = useI18n();
  const { state, advancedEnabled, update } = model;
  const diagnostics = state.diagnostics;
  const number = new Intl.NumberFormat(language);
  const stats = [
    { key: "tabs", label: t("browserStatTabs", "Tabs"), value: number.format(diagnostics.activeTabCount) },
    {
      key: "renderers",
      label: t("browserRendererProcesses", "Renderer processes"),
      value: number.format(diagnostics.rendererProcessCount),
    },
    {
      key: "working-set",
      label: t("browserRendererWorkingSet", "Working set"),
      value: `${number.format(Math.round(diagnostics.rendererWorkingSetBytes / MEBIBYTE))} MB`,
    },
    {
      key: "requests",
      label: t("browserCapturedRequests", "Captured requests"),
      value: number.format(diagnostics.capturedRequestCount),
    },
  ];
  const reset = () => {
    if (!window.confirm(t("browserResetConfirm", "Reset Browser settings and revoke all Browser capabilities?")))
      return;
    void window.piBridge.browserReset().then(model.setState).catch(model.report);
  };
  const clearAll = () =>
    model.run(() =>
      Promise.all(state.profiles.map((profile) => window.piBridge.browserClearProfileData(profile.id, "all"))),
    );

  return (
    <SettingGroup title={t("browserDiagnosticsReset", "Advanced and diagnostics")}>
      <ToggleRow
        label={t("browserEnableAdvancedForLaunch", "Enable Advanced Browser Mode for this launch")}
        description={t(
          "browserAdvancedModeWarning",
          "Turns on JavaScript execution, identity overrides, network bodies and request replay, certificate bypass, and unrestricted CDP together. Lasts for this launch only.",
        )}
        checked={advancedEnabled}
        onChange={(enabled) => void update({ advancedBrowserMode: { enabled } })}
      />
      <div className="ui-setting-row type-body-default" data-divider style={noticeStyle}>
        <span style={{ display: "flex", paddingTop: "1px", color: "var(--fx-status-warning)" }}>
          <BrowserIcon name="triangle-alert" size={15} strokeWidth={2} />
        </span>
        <span style={{ flex: 1, minWidth: 0, textWrap: "pretty" }}>
          {t(
            "browserAdvancedRuntimeConfirmations",
            "You type a confirmation phrase before turning it on; even then, high-risk actions still ask every time.",
          )}
        </span>
      </div>
      {advancedEnabled && <AdvancedModeFields model={model} />}
      <ActionsRow style={summaryRowStyle}>
        <dl style={statsStyle}>
          {stats.map((stat) => (
            <div key={stat.key} style={statCardStyle}>
              <dt className="type-label-default" style={{ color: "var(--fx-text-tertiary)" }}>
                {stat.label}
              </dt>
              <dd className="type-mono-number" style={{ margin: 0, color: "var(--fx-text-primary)" }}>
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>
        <div style={actionsStyle}>
          <Button onClick={() => void window.piBridge.exportDiagnostics()}>
            <BrowserIcon name="download" size={14} strokeWidth={2} />
            {t("browserExportDiagnostics", "Export redacted diagnostics")}
          </Button>
          <Button onClick={() => model.run(() => window.piBridge.browserCloseAllTabs())}>
            <BrowserIcon name="x" size={14} strokeWidth={2} />
            {t("browserCloseAllTabs", "Close all tabs")}
          </Button>
          <RowSpacer />
          <Button variant="danger" onClick={clearAll}>
            <BrowserIcon name="trash-2" size={14} strokeWidth={2} />
            {t("browserClearAllData", "Clear all browser data")}
          </Button>
          <Button variant="danger" onClick={reset}>
            <BrowserIcon name="rotate-ccw" size={14} strokeWidth={2} />
            {t("browserReset", "Reset Browser")}
          </Button>
        </div>
      </ActionsRow>
    </SettingGroup>
  );
}

const noticeStyle = {
  display: "flex",
  alignItems: "flex-start",
  gap: "10px",
  padding: "12px 20px",
  background: "var(--fx-status-warning-soft)",
  color: "var(--fx-text-secondary)",
} as const;
const summaryRowStyle = {
  flexDirection: "column",
  alignItems: "stretch",
  flexWrap: "nowrap",
  gap: "14px",
  padding: "16px 20px",
} as const;
const statsStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(4, minmax(50px, 1fr))",
  gap: "12px",
  margin: 0,
} as const;
const statCardStyle = {
  display: "grid",
  alignContent: "start",
  gap: "4px",
  padding: "12px",
  border: "1px solid var(--fx-line-default)",
  borderRadius: "var(--radius-card)",
  background: "var(--fx-surface-raised)",
} as const;
const actionsStyle = { display: "flex", alignItems: "center", flexWrap: "wrap", gap: "8px" } as const;
