import { useEffect, useRef } from "react";
import { useI18n } from "@/i18n";
import { SkillsConfig } from "../SkillsConfig";
import { PluginsConfig } from "../PluginsConfig";

// Phase 4: the resource main page — one sidebar entry opening a page with the
// two approved tabs. The embedded configs provide the full management
// capabilities; the tab switch is a controlled local decision here, and the
// leave protection (Phase 10) plus the production entry (Phase 11) hook into
// the same onTabChange path.

export type ResourceTab = "plugins" | "skills";

export function ResourcePage({
  cwd,
  sessionId = null,
  activeTab,
  onTabChange,
  onPluginsReloaded,
}: {
  cwd: string;
  sessionId?: string | null;
  activeTab: ResourceTab;
  onTabChange: (tab: ResourceTab) => void;
  onPluginsReloaded?: () => void;
}) {
  const { t } = useI18n();
  const tabs: { id: ResourceTab; label: string }[] = [
    { id: "plugins", label: t("pluginsTab", "Plugins") },
    { id: "skills", label: t("skillsTab", "Skills") },
  ];
  const activeIndex = tabs.findIndex((tab) => tab.id === activeTab);
  // Keyboard arrow switches must keep focus on the newly selected tab once
  // the controlled parent accepts the change (review R4). The ref-based
  // effect only fires when the requested tab actually became active, so a
  // rejected transition (future leave protection) leaves focus untouched.
  const pendingFocusRef = useRef<ResourceTab | null>(null);
  const tabRefsRef = useRef(new Map<ResourceTab, unknown>());

  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending || pending !== activeTab) return;
    pendingFocusRef.current = null;
    const element = tabRefsRef.current.get(pending) as { focus?: () => void } | undefined;
    element?.focus?.();
  }, [activeTab]);

  const move = (delta: -1 | 1) => {
    const nextIndex = Math.min(tabs.length - 1, Math.max(0, activeIndex + delta));
    if (nextIndex === activeIndex) return;
    const nextTab = tabs[nextIndex];
    pendingFocusRef.current = nextTab.id;
    onTabChange(nextTab.id);
  };

  return (
    <div
      className="app-nav-resource"
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "var(--bg)",
      }}
    >
      <header
        style={{
          padding: "14px 20px 10px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexShrink: 0,
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: "var(--text-title)",
            fontWeight: 600,
            color: "var(--text)",
            letterSpacing: "-0.01em",
          }}
        >
          {t("navPluginsSkills", "Plugins & Skills")}
        </h1>
        <div
          role="tablist"
          aria-label={t("navPluginsSkills", "Plugins & Skills")}
          style={{
            display: "inline-flex",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-card)",
            overflow: "hidden",
          }}
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              ref={(element) => {
                if (element) tabRefsRef.current.set(tab.id, element);
                else tabRefsRef.current.delete(tab.id);
              }}
              aria-selected={activeTab === tab.id}
              tabIndex={activeTab === tab.id ? 0 : -1}
              onClick={() => onTabChange(tab.id)}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  move(-1);
                }
                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  move(1);
                }
              }}
              style={{
                height: 28,
                padding: "0 14px",
                background: activeTab === tab.id ? "var(--bg-selected)" : "transparent",
                border: tab.id === "plugins" ? "none" : "none",
                borderLeft: tab.id === "skills" ? "1px solid var(--border)" : "none",
                color: activeTab === tab.id ? "var(--text)" : "var(--text-muted)",
                cursor: "pointer",
                fontSize: "var(--text-label)",
                fontWeight: activeTab === tab.id ? 500 : 400,
                transition:
                  "background var(--duration-quick, 150ms) var(--ease-smooth-out, ease), color var(--duration-quick, 150ms) var(--ease-smooth-out, ease)",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>
      <div role="tabpanel" style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        {activeTab === "plugins" ? (
          <PluginsConfig
            cwd={cwd}
            sessionId={sessionId}
            embedded
            onClose={() => undefined}
            onReloaded={onPluginsReloaded}
          />
        ) : (
          <SkillsConfig cwd={cwd} embedded onClose={() => undefined} />
        )}
      </div>
    </div>
  );
}
