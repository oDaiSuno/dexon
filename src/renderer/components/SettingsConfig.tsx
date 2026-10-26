import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/hooks/useTheme";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/i18n";
import { ModelsConfig } from "./ModelsConfig";
import { ToolchainsConfig } from "./ToolchainsConfig";
import { BrowserSettings } from "./browser/BrowserSettings";
import { GeneralSettings } from "./settings/general-settings";
import { AboutSettings } from "./settings/about-settings";
import { PageTopBar } from "./page-top-bar";
import type { ChatAppearancePreferences } from "@shared/chat-appearance";

export type SettingsTab = "general" | "browser" | "models" | "tools" | "about";

interface SettingsConfigProps {
  cwd: string | null;
  sessionId: string | null;
  initialTab?: SettingsTab;
  navigationRequestId?: number;
  onClose: () => void;
  onModelsChanged: () => void;
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
  const pageRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef(false);
  const returnFocusRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );

  useEffect(() => {
    if (initialTab !== activeTabRef.current) setActiveTab(initialTab);
  }, [initialTab, navigationRequestId]);

  useEffect(() => {
    const returnFocus = returnFocusRef.current;
    return () => {
      if (restoreFocusRef.current) returnFocus?.focus();
    };
  }, []);

  useEffect(() => {
    const page = pageRef.current;
    if (page && !page.contains(document.activeElement)) {
      document.getElementById(`settings-tab-${activeTab}`)?.focus();
    }
  }, [activeTab, navigationRequestId]);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const close = () => {
    restoreFocusRef.current = true;
    closeRef.current();
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target;
      const page = pageRef.current;
      if (target !== document.body && !(target instanceof Node && page?.contains(target))) return;
      event.preventDefault();
      restoreFocusRef.current = true;
      closeRef.current();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: "general", label: t("general", "General") },
    { id: "models", label: t("models", "Models") },
    { id: "browser", label: t("browser", "Browser") },
    { id: "tools", label: t("developerTools", "Developer Tools") },
    { id: "about", label: t("about", "About") },
  ];

  return (
    <div
      ref={pageRef}
      role="region"
      aria-label={t("settings", "Settings")}
      tabIndex={-1}
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "var(--fx-surface-main)",
        outline: "none",
      }}
    >
      <PageTopBar
        parent={t("settings", "Settings")}
        current={tabs.find((tab) => tab.id === activeTab)?.label ?? ""}
        isMobile={isMobile}
        onBack={close}
      />

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
                {t("settingsDescription", "Manage app preferences, models, the browser, and app information.")}
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
          {activeTab === "about" && <AboutSettings onClose={close} />}
        </div>
      </div>
    </div>
  );
}
