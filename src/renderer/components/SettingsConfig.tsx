import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/hooks/useTheme";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/i18n";
import { ModelsConfig } from "./ModelsConfig";
import { ToolchainsConfig } from "./ToolchainsConfig";
import { BrowserSettings } from "./browser/BrowserSettings";
import { ChannelsConfig } from "./channels/ChannelsConfig";
import { GeneralSettings } from "./settings/general-settings";
import { AboutSettings } from "./settings/about-settings";
import type { ChannelsSnapshot } from "@shared/channel-types";
import type { ChatAppearancePreferences } from "@shared/chat-appearance";

export type SettingsTab = "general" | "browser" | "channels" | "models" | "tools" | "about";

interface SettingsConfigProps {
  cwd: string | null;
  sessionId: string | null;
  initialTab?: SettingsTab;
  navigationRequestId?: number;
  onClose: () => void;
  onModelsChanged: () => void;
  onChannelsChanged: (snapshot: ChannelsSnapshot) => void;
  chatAppearance: ChatAppearancePreferences;
  chatAppearanceSaving: boolean;
  onChatAppearanceChange: (preferences: ChatAppearancePreferences) => Promise<void>;
}

export function SettingsConfig({
  cwd,
  sessionId,
  initialTab = "general",
  navigationRequestId = 0,
  onClose,
  onModelsChanged,
  onChannelsChanged,
  chatAppearance,
  chatAppearanceSaving,
  onChatAppearanceChange,
}: SettingsConfigProps) {
  const isMobile = useIsMobile();
  const { isDark, toggleTheme } = useTheme();
  const { language, setLanguage, t } = useI18n();
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );

  useEffect(() => {
    if (initialTab !== activeTabRef.current) setActiveTab(initialTab);
  }, [initialTab, navigationRequestId]);

  useEffect(() => {
    const returnFocus = returnFocusRef.current;
    closeButtonRef.current?.focus();
    return () => {
      returnFocus?.focus();
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.contains(document.activeElement)) {
      document.getElementById(`settings-tab-${activeTab}`)?.focus();
    }
  }, [activeTab, navigationRequestId]);

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: "general", label: t("general", "General") },
    { id: "models", label: t("models", "Models") },
    { id: "browser", label: t("browser", "Browser") },
    { id: "channels", label: t("channels", "Channels") },
    { id: "tools", label: t("developerTools", "Developer Tools") },
    { id: "about", label: t("about", "About") },
  ];

  return (
    <div
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "var(--fx-surface-scrim)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("settings", "Settings")}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
            return;
          }
          if (event.key !== "Tab") return;

          const dialog = dialogRef.current;
          if (!dialog) return;
          const focusable = Array.from(
            dialog.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          ).filter((element) => element.getClientRects().length > 0);
          if (focusable.length === 0) {
            event.preventDefault();
            dialog.focus();
            return;
          }

          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
        tabIndex={-1}
        style={{
          width: isMobile ? "calc(100vw - 16px)" : 960,
          maxWidth: "calc(100vw - 16px)",
          height: isMobile ? "calc(100dvh - 16px)" : "82vh",
          maxHeight: "calc(100dvh - 16px)",
          background: "var(--fx-surface-main)",
          border: "1px solid var(--fx-line-default)",
          borderRadius: "var(--radius-dialog)",
          display: "flex",
          flexDirection: "column",
          boxShadow: "var(--shadow-dialog)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            height: 56,
            padding: isMobile ? "0 var(--space-4)" : "0 var(--space-6)",
            borderBottom: "1px solid var(--fx-line-subtle)",
            background: "var(--fx-surface-main)",
            flexShrink: 0,
          }}
        >
          <span className="type-body-large" style={{ color: "var(--fx-text-secondary)" }}>
            {t("settings", "Settings")}
          </span>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{ flexShrink: 0, color: "var(--fx-text-tertiary)" }}
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
          <span
            className="type-body-large-medium"
            style={{
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              color: "var(--fx-text-primary)",
            }}
          >
            {tabs.find((tab) => tab.id === activeTab)?.label}
          </span>
          <div style={{ flex: 1 }} />
          <button
            ref={closeButtonRef}
            type="button"
            className="ui-button"
            data-variant="ghost"
            onClick={onClose}
            aria-label={t("close", "Close")}
            style={{ width: 32, padding: 0, marginRight: -6 }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <div
          style={{
            flexShrink: 0,
            padding: isMobile ? "var(--space-5) var(--space-4) 0" : "var(--space-8) var(--space-6) 0",
          }}
        >
          <div style={{ maxWidth: 760, margin: "0 auto", display: "grid", gap: 28 }}>
            <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
              <div className="type-title-page" style={{ color: "var(--fx-text-primary)" }}>
                {t("settings", "Settings")}
              </div>
              {!isMobile && (
                <div className="type-body-large" style={{ color: "var(--fx-text-secondary)" }}>
                  {t("settingsDescription", "Manage app preferences, models, channels, and app information.")}
                </div>
              )}
            </div>
            <div
              role="tablist"
              aria-label={t("settings", "Settings")}
              aria-orientation="vertical"
              style={{
                display: "flex",
                alignItems: "flex-end",
                gap: isMobile ? "var(--space-4)" : "var(--space-6)",
                borderBottom: "1px solid var(--fx-line-subtle)",
                overflowX: "auto",
                scrollbarWidth: "none",
              }}
            >
              {tabs.map((tab) => {
                const active = tab.id === activeTab;
                return (
                  <button
                    key={tab.id}
                    id={`settings-tab-${tab.id}`}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    aria-controls="settings-tabpanel"
                    tabIndex={active ? 0 : -1}
                    onClick={() => {
                      if (!active) setActiveTab(tab.id);
                    }}
                    onKeyDown={(event) => {
                      const currentIndex = tabs.findIndex((item) => item.id === tab.id);
                      let nextIndex: number | undefined;
                      if (event.key === "ArrowDown") nextIndex = (currentIndex + 1) % tabs.length;
                      if (event.key === "ArrowUp") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
                      if (event.key === "Home") nextIndex = 0;
                      if (event.key === "End") nextIndex = tabs.length - 1;
                      if (nextIndex === undefined) return;
                      event.preventDefault();
                      const nextTab = tabs[nextIndex];
                      setActiveTab(nextTab.id);
                      document.getElementById(`settings-tab-${nextTab.id}`)?.focus();
                    }}
                    className={active ? "type-body-large-medium" : "type-body-large"}
                    style={{
                      flexShrink: 0,
                      display: "flex",
                      alignItems: "flex-start",
                      height: 36,
                      marginBottom: -1,
                      padding: 0,
                      border: "none",
                      borderBottom: `2px solid ${active ? "var(--fx-text-primary)" : "transparent"}`,
                      background: "transparent",
                      color: active ? "var(--fx-text-primary)" : "var(--fx-text-secondary)",
                      whiteSpace: "nowrap",
                      cursor: "pointer",
                      transition:
                        "color var(--duration-quick) var(--ease-out), border-color var(--duration-quick) var(--ease-out)",
                    }}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: "flex", overflow: "hidden" }}>
          <div
            id="settings-tabpanel"
            role="tabpanel"
            aria-labelledby={`settings-tab-${activeTab}`}
            style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden", display: "flex" }}
          >
            {activeTab === "general" && (
              <GeneralSettings
                language={language}
                onLanguageChange={setLanguage}
                isDark={isDark}
                onThemeChange={(nextDark) => {
                  if (nextDark !== isDark) toggleTheme();
                }}
                chatAppearance={chatAppearance}
                chatAppearanceSaving={chatAppearanceSaving}
                onChatAppearanceChange={onChatAppearanceChange}
              />
            )}
            {activeTab === "browser" && <BrowserSettings sessionId={sessionId} />}
            {activeTab === "models" && (
              <ModelsConfig embedded cwd={cwd} onClose={() => undefined} onChanged={onModelsChanged} />
            )}
            {activeTab === "tools" && <ToolchainsConfig cwd={cwd} />}
            {activeTab === "channels" && <ChannelsConfig onSnapshotChange={onChannelsChanged} />}
            {activeTab === "about" && <AboutSettings onClose={onClose} />}
          </div>
        </div>
      </div>
    </div>
  );
}
