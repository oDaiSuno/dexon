import { useEffect, useId, useState } from "react";
import { useI18n, type AppLanguage } from "@/i18n";
import type { ChatAppearancePreferences, ChatFontSize, ChatLayout } from "@shared/chat-appearance";
import type { ManagedProcessCapability } from "../../../contract/processes";
import { isAutoSessionTitleEnabled, setAutoSessionTitleEnabled } from "../../lib/auto-session-title";
import { SettingRow, selectClassName, selectStyle } from "./setting-row";
import { SessionOrchestrationSettings } from "./session-orchestration-settings";
import { Toggle } from "../form-controls";

export function GeneralSettings({
  language,
  onLanguageChange,
  isDark,
  onThemeChange,
  chatAppearance,
  chatAppearanceSaving,
  onChatAppearanceChange,
}: {
  language: AppLanguage;
  onLanguageChange: (language: AppLanguage) => void;
  isDark: boolean;
  onThemeChange: (dark: boolean) => void;
  chatAppearance: ChatAppearancePreferences;
  chatAppearanceSaving: boolean;
  onChatAppearanceChange: (preferences: ChatAppearancePreferences) => Promise<void>;
}) {
  const { t } = useI18n();
  const [backgroundMode, setBackgroundMode] = useState(true);
  const [backgroundModeLoading, setBackgroundModeLoading] = useState(true);
  const [backgroundModeSaving, setBackgroundModeSaving] = useState(false);
  const [backgroundModeError, setBackgroundModeError] = useState<"load" | "save" | null>(null);
  const [managedProcessesEnabled, setManagedProcessesEnabled] = useState(false);
  const [managedProcessesLoading, setManagedProcessesLoading] = useState(true);
  const [managedProcessesSaving, setManagedProcessesSaving] = useState(false);
  const [managedProcessesError, setManagedProcessesError] = useState<"load" | "save" | null>(null);
  const [managedProcessCapability, setManagedProcessCapability] = useState<ManagedProcessCapability | null>(null);
  const [autoSessionTitle, setAutoSessionTitle] = useState(() => isAutoSessionTitleEnabled());
  const [chatAppearanceError, setChatAppearanceError] = useState(false);
  const languageControlId = useId();
  const backgroundModeControlId = useId();
  const managedProcessesControlId = useId();
  const autoSessionTitleControlId = useId();
  const chatFontSizeControlId = useId();
  const chatLayoutControlId = useId();
  const themeControlId = useId();
  useEffect(() => {
    let disposed = false;
    void Promise.all([window.piBridge.getUiState(), window.piBridge.getManagedProcessCapability()])
      .then(([state, capability]) => {
        if (!disposed) {
          setBackgroundMode(state.backgroundMode !== false);
          setManagedProcessesEnabled(state.managedProcessesEnabled === true);
          setManagedProcessCapability(capability);
        }
      })
      .catch(() => {
        if (!disposed) {
          setBackgroundModeError("load");
          setManagedProcessesError("load");
        }
      })
      .finally(() => {
        if (!disposed) {
          setBackgroundModeLoading(false);
          setManagedProcessesLoading(false);
        }
      });
    return () => {
      disposed = true;
    };
  }, []);

  const saveBackgroundMode = async (next: boolean): Promise<void> => {
    const previous = backgroundMode;
    setBackgroundMode(next);
    setBackgroundModeSaving(true);
    setBackgroundModeError(null);
    try {
      await window.piBridge.setUiState({ backgroundMode: next });
    } catch {
      setBackgroundMode(previous);
      setBackgroundModeError("save");
    } finally {
      setBackgroundModeSaving(false);
    }
  };
  const saveManagedProcesses = async (next: boolean): Promise<void> => {
    const previous = managedProcessesEnabled;
    setManagedProcessesEnabled(next);
    setManagedProcessesSaving(true);
    setManagedProcessesError(null);
    try {
      await window.piBridge.setUiState({ managedProcessesEnabled: next });
    } catch {
      setManagedProcessesEnabled(previous);
      setManagedProcessesError("save");
    } finally {
      setManagedProcessesSaving(false);
    }
  };
  const saveChatAppearance = async (next: ChatAppearancePreferences): Promise<void> => {
    setChatAppearanceError(false);
    try {
      await onChatAppearanceChange(next);
    } catch {
      setChatAppearanceError(true);
    }
  };
  const managedProcessCapabilityMessage = (() => {
    if (!managedProcessCapability || managedProcessCapability.ready) return null;
    switch (managedProcessCapability.errorCode) {
      case "ARCH_UNSUPPORTED":
        return t("managedProcessesArchUnsupported", "Managed processes require Windows x64 on this platform.");
      case "HELPER_MISSING":
        return t(
          "managedProcessesHelperMissing",
          "The Windows process helper is missing. Reinstall the app, then restart it.",
        );
      case "HELPER_INTEGRITY":
        return t(
          "managedProcessesHelperIntegrity",
          "The Windows process helper failed its integrity check. Reinstall the app, then restart it.",
        );
      case "OWNER_IDENTITY_UNAVAILABLE":
        return t(
          "managedProcessesOwnerUnavailable",
          "Windows process ownership could not be verified. Restart the app before enabling this feature.",
        );
      case "REAPER_UNHEALTHY":
        return t(
          "managedProcessesReaperUnhealthy",
          "A previous process tree could not be safely verified as stopped. Restart the app or export diagnostics.",
        );
      default:
        return t("managedProcessesUnsupported", "Managed processes are not available on this platform.");
    }
  })();
  const managedProcessesUnavailable = !managedProcessCapability?.ready;
  return (
    <div style={{ width: "100%", overflowY: "auto", padding: "28px clamp(20px, 5vw, 52px)" }}>
      <section style={{ maxWidth: 620 }}>
        <h2 style={{ margin: 0, fontSize: "var(--text-body-lg)", color: "var(--text)" }}>
          {t("interfaceLanguage", "Interface language")}
        </h2>
        <p style={{ margin: "8px 0 16px", fontSize: "var(--text-label)", lineHeight: 1.6, color: "var(--text-dim)" }}>
          {t("interfaceLanguageDescription", "Choose the language used by the app. Changes take effect immediately.")}
        </p>
        <SettingRow label={t("language", "Language")} controlId={languageControlId}>
          <select
            id={languageControlId}
            value={language}
            onChange={(event) => onLanguageChange(event.target.value as AppLanguage)}
            className={selectClassName}
            style={selectStyle}
          >
            <option value="en-US">English</option>
            <option value="zh-CN">简体中文</option>
          </select>
        </SettingRow>
      </section>

      <div style={{ height: 1, background: "var(--border)", maxWidth: 620, margin: "28px 0" }} />

      <section style={{ maxWidth: 620 }}>
        <h2 style={{ margin: 0, fontSize: "var(--text-body-lg)", color: "var(--text)" }}>
          {t("managedProcesses", "Managed processes")}
        </h2>
        <p style={{ margin: "8px 0 16px", fontSize: "var(--text-label)", lineHeight: 1.6, color: "var(--text-dim)" }}>
          {t(
            "managedProcessesDescription",
            "Let Agents run development servers and watchers under app-owned lifecycle control. Processes have the same local access as Bash and are not a sandbox.",
          )}
        </p>
        <SettingRow
          label={t("managedProcessesEnable", "Enable managed background processes")}
          controlId={managedProcessesControlId}
        >
          <label
            htmlFor={managedProcessesControlId}
            style={{
              width: 36,
              height: 36,
              display: "grid",
              placeItems: "center",
              flexShrink: 0,
              cursor: managedProcessesUnavailable ? "not-allowed" : "pointer",
            }}
          >
            <Toggle
              id={managedProcessesControlId}
              checked={managedProcessesEnabled}
              disabled={managedProcessesUnavailable || managedProcessesLoading || managedProcessesSaving}
              onChange={(event) => void saveManagedProcesses(event.target.checked)}
            />
          </label>
        </SettingRow>
        {managedProcessCapabilityMessage && (
          <p style={{ margin: "8px 0 0", fontSize: "var(--text-label)", lineHeight: 1.55, color: "var(--text-dim)" }}>
            {managedProcessCapabilityMessage}
          </p>
        )}
        {managedProcessCapability?.ready &&
          managedProcessCapability.backend === "windows-job" &&
          managedProcessCapability.helperProvenance === "windows-native-dev" && (
            <p style={{ margin: "8px 0 0", fontSize: "var(--text-label)", lineHeight: 1.55, color: "var(--text-dim)" }}>
              {t("managedProcessesDeveloperBuild", "Developer build — not a release-validated Windows helper.")}
            </p>
          )}
        {managedProcessesError && (
          <p
            role="alert"
            style={{ margin: "8px 0 0", fontSize: "var(--text-label)", lineHeight: 1.55, color: "var(--danger)" }}
          >
            {managedProcessesError === "save"
              ? t(
                  "managedProcessesSaveFailed",
                  "Managed process settings could not be saved. The previous setting was restored.",
                )
              : t(
                  "managedProcessesLoadFailed",
                  "Managed process settings could not be loaded. The feature remains disabled.",
                )}
          </p>
        )}
      </section>

      <div style={{ height: 1, background: "var(--border)", maxWidth: 620, margin: "28px 0" }} />

      <SessionOrchestrationSettings />

      <div style={{ height: 1, background: "var(--border)", maxWidth: 620, margin: "28px 0" }} />

      <section style={{ maxWidth: 620 }}>
        <h2 style={{ margin: 0, fontSize: "var(--text-body-lg)", color: "var(--text)" }}>
          {t("backgroundMode", "Background mode")}
        </h2>
        <p style={{ margin: "8px 0 16px", fontSize: "var(--text-label)", lineHeight: 1.6, color: "var(--text-dim)" }}>
          {t("backgroundModeDescription", "Keep messaging channels connected when the window is closed.")}
        </p>
        <SettingRow label={t("closeToTray", "Close window to tray")} controlId={backgroundModeControlId}>
          <label
            htmlFor={backgroundModeControlId}
            style={{
              width: 36,
              height: 36,
              display: "grid",
              placeItems: "center",
              flexShrink: 0,
              cursor: "pointer",
            }}
          >
            <Toggle
              id={backgroundModeControlId}
              checked={backgroundMode}
              disabled={backgroundModeLoading || backgroundModeSaving}
              onChange={(event) => {
                void saveBackgroundMode(event.target.checked);
              }}
            />
          </label>
        </SettingRow>
        {backgroundModeError && (
          <p
            role="alert"
            style={{ margin: "8px 0 0", fontSize: "var(--text-label)", lineHeight: 1.55, color: "var(--danger)" }}
          >
            {backgroundModeError === "save"
              ? t("backgroundModeSaveFailed", "Background mode could not be saved. The previous setting was restored.")
              : t("backgroundModeLoadFailed", "Background mode could not be loaded. The default remains selected.")}
          </p>
        )}
      </section>

      <div style={{ height: 1, background: "var(--border)", maxWidth: 620, margin: "28px 0" }} />

      <section style={{ maxWidth: 620 }}>
        <h2 style={{ margin: 0, fontSize: "var(--text-body-lg)", color: "var(--text)" }}>
          {t("conversationSettings", "Conversation")}
        </h2>
        <p style={{ margin: "8px 0 16px", fontSize: "var(--text-label)", lineHeight: 1.6, color: "var(--text-dim)" }}>
          {t(
            "conversationSettingsDescription",
            "Control automatic titles, chat text size, and the conversation reading width.",
          )}
        </p>
        <div style={{ display: "grid", gap: 12 }}>
          <SettingRow label={t("autoSessionTitle", "Auto-title new sessions")} controlId={autoSessionTitleControlId}>
            <label
              htmlFor={autoSessionTitleControlId}
              style={{
                width: 36,
                height: 36,
                display: "grid",
                placeItems: "center",
                flexShrink: 0,
                cursor: "pointer",
              }}
            >
              <Toggle
                id={autoSessionTitleControlId}
                checked={autoSessionTitle}
                onChange={(event) => {
                  const next = event.target.checked;
                  setAutoSessionTitle(next);
                  setAutoSessionTitleEnabled(next);
                }}
              />
            </label>
          </SettingRow>
          <SettingRow label={t("chatFontSize", "Chat text size")} controlId={chatFontSizeControlId}>
            <select
              id={chatFontSizeControlId}
              value={chatAppearance.fontSize}
              disabled={chatAppearanceSaving}
              onChange={(event) => {
                void saveChatAppearance({
                  ...chatAppearance,
                  fontSize: event.target.value as ChatFontSize,
                });
              }}
              className={selectClassName}
              style={{ ...selectStyle, cursor: chatAppearanceSaving ? "wait" : "pointer" }}
            >
              <option value="small">{t("chatFontSizeSmall", "Small")}</option>
              <option value="standard">{t("chatFontSizeStandard", "Standard")}</option>
              <option value="large">{t("chatFontSizeLarge", "Large")}</option>
              <option value="extra-large">{t("chatFontSizeExtraLarge", "Extra large")}</option>
            </select>
          </SettingRow>
          <SettingRow label={t("chatLayout", "Conversation width")} controlId={chatLayoutControlId}>
            <select
              id={chatLayoutControlId}
              value={chatAppearance.layout}
              disabled={chatAppearanceSaving}
              onChange={(event) => {
                void saveChatAppearance({
                  ...chatAppearance,
                  layout: event.target.value as ChatLayout,
                });
              }}
              className={selectClassName}
              style={{ ...selectStyle, cursor: chatAppearanceSaving ? "wait" : "pointer" }}
            >
              <option value="fixed">{t("chatLayoutFixed", "Comfortable width")}</option>
              <option value="wide">{t("chatLayoutWide", "Expanded width")}</option>
            </select>
          </SettingRow>
        </div>
        {chatAppearanceError && (
          <p
            role="alert"
            style={{ margin: "8px 0 0", fontSize: "var(--text-label)", lineHeight: 1.55, color: "var(--danger)" }}
          >
            {t("chatAppearanceSaveFailed", "Chat appearance could not be saved. The previous settings were restored.")}
          </p>
        )}
      </section>

      <div style={{ height: 1, background: "var(--border)", maxWidth: 620, margin: "28px 0" }} />

      <section style={{ maxWidth: 620 }}>
        <h2 style={{ margin: 0, fontSize: "var(--text-body-lg)", color: "var(--text)" }}>
          {t("appearance", "Appearance")}
        </h2>
        <p style={{ margin: "8px 0 16px", fontSize: "var(--text-label)", lineHeight: 1.6, color: "var(--text-dim)" }}>
          {t("appearanceDescription", "Choose the color mode used by the app.")}
        </p>
        <SettingRow label={t("theme", "Theme")} controlId={themeControlId}>
          <select
            id={themeControlId}
            value={isDark ? "dark" : "light"}
            onChange={(event) => onThemeChange(event.target.value === "dark")}
            className={selectClassName}
            style={selectStyle}
          >
            <option value="light">{t("light", "Light")}</option>
            <option value="dark">{t("dark", "Dark")}</option>
          </select>
        </SettingRow>
      </section>
    </div>
  );
}
