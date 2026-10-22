import { useEffect, useId, useState } from "react";
import { useI18n, type AppLanguage } from "@/i18n";
import type { ChatAppearancePreferences, ChatFontSize, ChatLayout } from "@shared/chat-appearance";
import type { ManagedProcessCapability } from "../../../contract/processes";
import { isAutoSessionTitleEnabled, setAutoSessionTitleEnabled } from "../../lib/auto-session-title";
import { SettingGroup, SettingNote, SettingRow, selectClassName, selectStyle, toggleHitAreaStyle } from "./setting-row";
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
    <div style={{ width: "100%", overflowY: "auto", padding: "var(--space-6) var(--space-6) var(--space-10)" }}>
      <div style={{ maxWidth: 760, margin: "0 auto", display: "grid", gap: 28 }}>
        <SettingGroup title={t("interfaceLanguage", "Interface language")}>
          <SettingRow
            label={t("language", "Language")}
            description={t(
              "interfaceLanguageDescription",
              "Choose the language used by the app. Changes take effect immediately.",
            )}
            controlId={languageControlId}
          >
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
        </SettingGroup>

        <SettingGroup
          title={t("managedProcesses", "Managed processes")}
          notes={
            <>
              {managedProcessCapabilityMessage && <SettingNote>{managedProcessCapabilityMessage}</SettingNote>}
              {managedProcessCapability?.ready &&
                managedProcessCapability.backend === "windows-job" &&
                managedProcessCapability.helperProvenance === "windows-native-dev" && (
                  <SettingNote>
                    {t("managedProcessesDeveloperBuild", "Developer build — not a release-validated Windows helper.")}
                  </SettingNote>
                )}
              {managedProcessesError && (
                <SettingNote alert>
                  {managedProcessesError === "save"
                    ? t(
                        "managedProcessesSaveFailed",
                        "Managed process settings could not be saved. The previous setting was restored.",
                      )
                    : t(
                        "managedProcessesLoadFailed",
                        "Managed process settings could not be loaded. The feature remains disabled.",
                      )}
                </SettingNote>
              )}
            </>
          }
        >
          <SettingRow
            label={t("managedProcessesEnable", "Enable managed background processes")}
            description={t(
              "managedProcessesDescription",
              "Let Agents run development servers and watchers under app-owned lifecycle control. Processes have the same local access as Bash and are not a sandbox.",
            )}
            controlId={managedProcessesControlId}
          >
            <label
              htmlFor={managedProcessesControlId}
              style={{ ...toggleHitAreaStyle, cursor: managedProcessesUnavailable ? "not-allowed" : "pointer" }}
            >
              <Toggle
                id={managedProcessesControlId}
                checked={managedProcessesEnabled}
                disabled={managedProcessesUnavailable || managedProcessesLoading || managedProcessesSaving}
                onChange={(event) => void saveManagedProcesses(event.target.checked)}
              />
            </label>
          </SettingRow>
        </SettingGroup>

        <SessionOrchestrationSettings />

        <SettingGroup
          title={t("backgroundMode", "Background mode")}
          notes={
            backgroundModeError && (
              <SettingNote alert>
                {backgroundModeError === "save"
                  ? t(
                      "backgroundModeSaveFailed",
                      "Background mode could not be saved. The previous setting was restored.",
                    )
                  : t("backgroundModeLoadFailed", "Background mode could not be loaded. The default remains selected.")}
              </SettingNote>
            )
          }
        >
          <SettingRow
            label={t("closeToTray", "Close window to tray")}
            description={t("backgroundModeDescription", "Keep messaging channels connected when the window is closed.")}
            controlId={backgroundModeControlId}
          >
            <label htmlFor={backgroundModeControlId} style={{ ...toggleHitAreaStyle, cursor: "pointer" }}>
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
        </SettingGroup>

        <SettingGroup
          title={t("conversationSettings", "Conversation")}
          notes={
            chatAppearanceError && (
              <SettingNote alert>
                {t(
                  "chatAppearanceSaveFailed",
                  "Chat appearance could not be saved. The previous settings were restored.",
                )}
              </SettingNote>
            )
          }
        >
          <SettingRow
            label={t("autoSessionTitle", "Auto-title new sessions")}
            description={t(
              "conversationSettingsDescription",
              "Control automatic titles, chat text size, and the conversation reading width.",
            )}
            controlId={autoSessionTitleControlId}
          >
            <label htmlFor={autoSessionTitleControlId} style={{ ...toggleHitAreaStyle, cursor: "pointer" }}>
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
                const fontSize = event.target.value as ChatFontSize;
                void saveChatAppearance({ ...chatAppearance, fontSize });
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
        </SettingGroup>

        <SettingGroup title={t("appearance", "Appearance")}>
          <SettingRow
            label={t("theme", "Theme")}
            description={t("appearanceDescription", "Choose the color mode used by the app.")}
            controlId={themeControlId}
          >
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
        </SettingGroup>
      </div>
    </div>
  );
}
