import { useCallback, useEffect, useRef } from "react";
import { useI18n } from "@/i18n";
import type { PluginPackageInfo } from "@/lib/api-types";
import type { ChannelsSnapshot } from "@shared/channel-types";
import { SkillsManager } from "../SkillsConfig";
import { PluginsManager } from "../PluginsConfig";
import { Button } from "../form-controls";
import { usePluginLibrary } from "../plugins/use-plugin-library";
import { packageKey } from "../plugins/plugin-shared";
import { useSkillDirectory } from "../skills/use-skill-directory";
import { ResourcesOverview } from "../resources/resources-overview";
import { ChevronLeftIcon, ChevronRightIcon } from "../resources/overview-icons";

export type ResourceTab = "plugins" | "skills";
export type ResourceView = "overview" | "manage";

interface ResourcePageProps {
  cwd: string;
  sessionId?: string | null;
  view: ResourceView;
  onViewChange: (view: ResourceView) => void;
  activeTab: ResourceTab;
  onTabChange: (tab: ResourceTab) => void;
  onPluginsReloaded?: () => void;
  channelSnapshot: ChannelsSnapshot;
  onOpenRemote: () => void;
}

export function ResourcePage(props: ResourcePageProps) {
  return <ResourceWorkspace key={props.cwd} {...props} />;
}

function ResourceWorkspace({
  cwd,
  sessionId = null,
  view,
  onViewChange,
  activeTab,
  onTabChange,
  onPluginsReloaded,
  channelSnapshot,
  onOpenRemote,
}: ResourcePageProps) {
  const library = usePluginLibrary({ cwd, sessionId, onReloaded: onPluginsReloaded });
  const directory = useSkillDirectory(cwd);
  const skillsAddRef = useRef(false);
  const { loadPlugins } = library;
  const { loadSkills } = directory;
  const refresh = useCallback(() => {
    void loadPlugins();
    void loadSkills();
  }, [loadPlugins, loadSkills]);

  const manage = (tab: ResourceTab) => {
    onTabChange(tab);
    onViewChange("manage");
  };
  const openPackage = (pkg: PluginPackageInfo) => {
    library.selectPackage(packageKey(pkg));
    manage("plugins");
  };

  return (
    <div
      className="app-nav-resource"
      style={{
        flex: 1,
        minWidth: 0,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "var(--fx-surface-main)",
      }}
    >
      {view === "overview" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-[24px] py-[32px]">
          <ResourcesOverview
            cwd={cwd}
            library={library}
            directory={directory}
            canReload={sessionId !== null}
            channelSnapshot={channelSnapshot}
            onOpenRemote={onOpenRemote}
            onAdd={() => {
              library.openAddMode();
              manage("plugins");
            }}
            onRefresh={refresh}
            onDiscoverSkills={() => {
              skillsAddRef.current = true;
              manage("skills");
            }}
            onOpenPackage={openPackage}
            onManageSources={() => manage(activeTab)}
          />
        </div>
      ) : (
        <>
          <ManageHeader
            activeTab={activeTab}
            onTabChange={(tab) => {
              skillsAddRef.current = false;
              onTabChange(tab);
            }}
            onBack={() => onViewChange("overview")}
          />
          <div role="tabpanel" style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex" }}>
            {activeTab === "plugins" ? (
              <PluginsManager
                cwd={cwd}
                sessionId={sessionId}
                embedded
                onClose={() => undefined}
                library={library}
                onRefresh={refresh}
              />
            ) : (
              <SkillsManager
                cwd={cwd}
                embedded
                initialAddMode={skillsAddRef.current}
                onClose={() => undefined}
                directory={directory}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ManageHeader({
  activeTab,
  onTabChange,
  onBack,
}: {
  activeTab: ResourceTab;
  onTabChange: (tab: ResourceTab) => void;
  onBack: () => void;
}) {
  const { t } = useI18n();
  const tabs: { id: ResourceTab; label: string }[] = [
    { id: "plugins", label: t("pluginsTab", "Plugins") },
    { id: "skills", label: t("skillsTab", "Skills") },
  ];
  const activeIndex = tabs.findIndex((tab) => tab.id === activeTab);
  const pendingFocusRef = useRef<ResourceTab | null>(null);
  const tabRefsRef = useRef(new Map<ResourceTab, HTMLButtonElement>());

  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending || pending !== activeTab) return;
    pendingFocusRef.current = null;
    tabRefsRef.current.get(pending)?.focus();
  }, [activeTab]);

  const move = (delta: -1 | 1) => {
    const nextIndex = Math.min(tabs.length - 1, Math.max(0, activeIndex + delta));
    if (nextIndex === activeIndex) return;
    const nextTab = tabs[nextIndex];
    pendingFocusRef.current = nextTab.id;
    onTabChange(nextTab.id);
  };

  return (
    <header className="flex shrink-0 items-center gap-[12px] px-[20px] pt-[14px] pb-[10px]">
      <Button
        variant="ghost"
        onClick={onBack}
        aria-label={t("resourcesBackToOverview", "Back to Plugins & Skills")}
        className="w-[32px] px-0"
      >
        <ChevronLeftIcon size={16} />
      </Button>
      <h1 className="type-body-large m-0 text-[var(--fx-text-secondary)]">
        {t("navPluginsSkills", "Plugins & Skills")}
      </h1>
      <ChevronRightIcon size={14} className="text-[var(--fx-text-tertiary)]" />
      <span className="type-body-large-medium min-w-0 flex-1 truncate text-[var(--fx-text-primary)]">
        {t("resourcesManageSources", "Manage sources")}
      </span>
      <div
        role="tablist"
        aria-label={t("navPluginsSkills", "Plugins & Skills")}
        style={{
          display: "inline-flex",
          border: "1px solid var(--fx-line-default)",
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
            className={activeTab === tab.id ? "type-label-medium" : "type-label-default"}
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
              background: activeTab === tab.id ? "var(--fx-surface-selected)" : "transparent",
              border: "none",
              borderLeft: tab.id === "skills" ? "1px solid var(--fx-line-default)" : "none",
              color: activeTab === tab.id ? "var(--fx-text-primary)" : "var(--fx-text-secondary)",
              cursor: "pointer",
              transition:
                "background var(--duration-quick) var(--ease-smooth-out), color var(--duration-quick) var(--ease-smooth-out)",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </header>
  );
}
