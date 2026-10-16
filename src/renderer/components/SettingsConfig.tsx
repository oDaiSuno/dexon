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
        background: "rgba(0,0,0,0.35)",
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
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-card)",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "12px 20px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: "var(--text-title)", fontWeight: 700, color: "var(--text)" }}>
              {t("settings", "Settings")}
            </div>
            {!isMobile && (
              <div style={{ marginTop: 2, fontSize: "var(--text-meta)", color: "var(--text-dim)" }}>
                {t("settingsDescription", "Manage app preferences, models, channels, and app information.")}
              </div>
            )}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label={t("close", "Close")}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: "var(--text-display)",
              lineHeight: 1,
              width: 36,
              height: 36,
              padding: 0,
              borderRadius: "var(--radius-card)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            ×
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: "flex", overflow: "hidden" }}>
          <div
            role="tablist"
            aria-label={t("settings", "Settings")}
            aria-orientation="vertical"
            style={{
              width: isMobile ? 112 : 168,
              display: "flex",
              flexDirection: "column",
              gap: 4,
              padding: isMobile ? "10px 8px" : "12px 10px",
              borderRight: "1px solid var(--border)",
              overflowY: "auto",
              flexShrink: 0,
              background: "var(--bg-panel)",
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
                  style={{
                    position: "relative",
                    width: "100%",
                    minHeight: 40,
                    padding: isMobile ? "8px 10px" : "8px 12px",
                    border: `1px solid ${active ? "var(--accent)" : "transparent"}`,
                    borderRadius: "var(--radius-card)",
                    background: active ? "var(--accent-soft)" : "transparent",
                    color: active ? "var(--accent)" : "var(--text-muted)",
                    fontSize: "var(--text-label)",
                    lineHeight: 1.35,
                    fontWeight: active ? 650 : 500,
                    textAlign: "left",
                    cursor: "pointer",
                    overflowWrap: "anywhere",
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

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
