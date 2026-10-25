import { useState, type ReactNode } from "react";
import type { SessionInfo } from "@/lib/types";
import type { SessionLiveStatus } from "@shared/session-orchestration";
import { useI18n } from "@/i18n";
import { NavSpaceMenu, PanelLeftIcon } from "./nav-space-menu";
import { NavHistory } from "./nav-history";
import { NavTopBar } from "./nav-top-bar";
import { spaceFolderName } from "@/lib/space-identity";
import { worktreePathsEqual } from "@shared/worktree-path";
import { NewSessionIcon, PluginsIcon } from "./nav-icons";
import { RailButton, SettingsButton, UpdateButton } from "./nav-sidebar-buttons";
import appIconUrl from "../../../../build/icon.png";
import { NAV_EXPANDED_WIDTH, NAV_RAIL_WIDTH } from "@/lib/layout-preferences";
import { APP_VERSION } from "@/lib/app-version";

export { NAV_EXPANDED_WIDTH, NAV_RAIL_WIDTH };

export type NavPage = "chat" | "resources";

const ENTRY_ROW_HEIGHT = 36;
const NAV_ICON_SIZE = 18;

type MainEntry = {
  id: string;
  label: string;
  icon: ReactNode;
  page?: NavPage;
  onClick: () => void;
};

export function NavSidebar({
  expanded,
  page,
  settingsOpen = false,
  spaceName: spaceNameProp,
  spacePath,
  sessions,
  loading,
  error,
  selectedSessionId,
  liveStatuses,
  runningSessionIds,
  unreadSessionIds,
  homeDir,
  onToggleExpanded,
  onNavigate,
  onSelectSession,
  onNewSession,
  onRefreshSessions,
  onOpenSettings,
  onOpenUpdate,
  updateAvailable = false,
  onSessionDeleted,
  onChooseFolder,
  onOpenFolder,
  inspectFolder,
  onBackToPersonalSpace,
  spacePanel,
  foldedSessionIds,
  onToggleFold,
  currentProject,
  projectName,
  isPinnedProject,
  openProjects,
  onToggleProject,
}: {
  expanded: boolean;
  page: NavPage;
  settingsOpen?: boolean;
  spaceName?: string;
  spacePath: string;
  sessions: SessionInfo[];
  loading: boolean;
  error: string | null;
  selectedSessionId: string | null;
  liveStatuses?: Record<string, SessionLiveStatus>;
  runningSessionIds: Set<string>;
  unreadSessionIds: Set<string>;
  homeDir: string;
  onToggleExpanded: () => void;
  onNavigate: (page: NavPage) => void;
  onSelectSession: (session: SessionInfo) => void;
  onNewSession: () => void;
  onRefreshSessions: () => void;
  onOpenSettings: () => void;
  onOpenUpdate: () => void;
  updateAvailable?: boolean;
  onSessionDeleted?: (id: string) => void;
  onChooseFolder: () => void;
  onOpenFolder?: (folder: string) => void;
  inspectFolder?: (typed: string) => Promise<string | null>;
  onBackToPersonalSpace: () => void;
  spacePanel?: ReactNode;
  foldedSessionIds?: ReadonlySet<string>;
  onToggleFold?: (sessionId: string) => void;
  currentProject?: string;
  projectName?: (root: string) => string;
  isPinnedProject?: (root: string) => boolean;
  openProjects?: ReadonlyMap<string, boolean>;
  onToggleProject?: (key: string, open: boolean) => void;
}) {
  const { t } = useI18n();
  const spaceName = spaceNameProp ?? t("personalSpace", "Personal space");
  const [activeEntry, setActiveEntry] = useState(-1);
  const [query, setQuery] = useState("");
  if (!expanded && query) setQuery("");
  const projectRoot = currentProject ?? spacePath;
  const nameOfProject =
    projectName ?? ((root: string) => (worktreePathsEqual(root, projectRoot) ? spaceName : spaceFolderName(root)));
  const currentPage = settingsOpen ? null : page;
  const onNewSessionPage = currentPage === "chat" && selectedSessionId === null;

  if (!expanded) {
    return (
      <nav
        aria-label={t("mainNavigation", "Main navigation")}
        className="app-nav"
        style={{
          width: NAV_RAIL_WIDTH,
          background: "var(--fx-surface-sidebar)",
          borderRight: "1px solid var(--fx-line-subtle)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          height: "100%",
          overflow: "hidden",
          flexShrink: 0,
          padding: "var(--space-2) 0",
          gap: 6,
        }}
      >
        <RailButton label={t("showSidebar", "Show sidebar")} onClick={onToggleExpanded}>
          <PanelLeftIcon size={NAV_ICON_SIZE} />
        </RailButton>
        <img
          src={appIconUrl}
          alt=""
          aria-hidden="true"
          width={20}
          height={20}
          style={{ borderRadius: "var(--radius-chip)", flexShrink: 0 }}
        />
        <RailButton label={t("newSession", "New session")} onClick={onNewSession}>
          <NewSessionIcon size={NAV_ICON_SIZE} />
        </RailButton>
        <RailButton
          label={t("navPluginsSkills", "Plugins & Skills")}
          onClick={() => onNavigate("resources")}
          active={currentPage === "resources"}
        >
          <PluginsIcon size={NAV_ICON_SIZE} />
        </RailButton>
        <span style={{ flex: 1 }} />
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignSelf: "stretch",
            margin: "0 var(--space-2)",
            paddingTop: "var(--space-3)",
            borderTop: "1px solid var(--fx-line-subtle)",
          }}
        >
          <SettingsButton label={t("settings", "Settings")} active={settingsOpen} onClick={onOpenSettings} />
        </div>
      </nav>
    );
  }

  const entries: MainEntry[] = [
    {
      id: "new-session",
      label: t("newSession", "New session"),
      icon: <NewSessionIcon size={NAV_ICON_SIZE} />,
      onClick: onNewSession,
    },
    {
      id: "resources",
      label: t("navPluginsSkills", "Plugins & Skills"),
      icon: <PluginsIcon size={NAV_ICON_SIZE} />,
      page: "resources",
      onClick: () => onNavigate("resources"),
    },
  ];

  return (
    <nav
      aria-label={t("mainNavigation", "Main navigation")}
      className="app-nav"
      style={{
        width: NAV_EXPANDED_WIDTH,
        background: "var(--fx-surface-sidebar)",
        boxShadow: "inset -1px 0 0 var(--fx-line-subtle)",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        flexShrink: 0,
        padding: "16px 12px",
        gap: 4,
      }}
    >
      <NavTopBar query={query} onQueryChange={setQuery} onToggleExpanded={onToggleExpanded} />
      {spacePanel}

      <div
        style={{
          padding: "12px 0 16px 0",
          display: "flex",
          flexDirection: "column",
          gap: 2,
          flexShrink: 0,
        }}
      >
        {entries.map((entry, index) => {
          const current = entry.page === currentPage;
          const selected = current || (entry.id === "new-session" && onNewSessionPage);
          const hovered = !selected && activeEntry === index;
          return (
            <button
              key={entry.id}
              type="button"
              data-nav-entry
              aria-label={entry.label}
              aria-current={current ? "page" : undefined}
              className={selected ? "type-body-large-medium" : "type-body-large"}
              onMouseEnter={() => setActiveEntry(index)}
              onMouseLeave={() => setActiveEntry(-1)}
              onClick={entry.onClick}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-3)",
                width: "100%",
                height: ENTRY_ROW_HEIGHT,
                padding: "0 10px",
                background: selected
                  ? "var(--fx-surface-selected)"
                  : hovered
                    ? "var(--fx-surface-hover)"
                    : "transparent",
                border: `1px solid ${selected ? "var(--fx-line-strong)" : "transparent"}`,
                borderRadius: "var(--radius-control)",
                color: selected ? "var(--fx-text-primary)" : "var(--fx-text-body)",
                cursor: "pointer",
                textAlign: "left",
                transition:
                  "background var(--duration-quick, 150ms) var(--ease-smooth-out, ease), color var(--duration-quick, 150ms) var(--ease-smooth-out, ease)",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  display: "inline-flex",
                  width: NAV_ICON_SIZE,
                  height: NAV_ICON_SIZE,
                  flexShrink: 0,
                  color: selected ? "var(--fx-text-primary)" : "var(--fx-text-secondary)",
                }}
              >
                {entry.icon}
              </span>
              <span
                style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                {entry.label}
              </span>
            </button>
          );
        })}
      </div>

      <div
        style={{
          flex: "1 1 auto",
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <NavHistory
          sessions={sessions}
          query={query}
          loading={loading}
          error={error}
          tree={{
            currentProject: projectRoot,
            projectName: nameOfProject,
            isPinnedProject,
            openProjects,
            onToggleProject,
            onChooseFolder,
            renderCurrentActions: (name, revealed, projects) => (
              <NavSpaceMenu
                spaceName={name}
                projectPath={spacePath}
                homeDir={homeDir}
                revealed={revealed}
                projects={projects}
                onOpenFolder={onOpenFolder}
                inspectFolder={inspectFolder}
                onChooseFolder={onChooseFolder}
                onBackToPersonalSpace={onBackToPersonalSpace}
              />
            ),
          }}
          selectedSessionId={selectedSessionId}
          liveStatuses={liveStatuses}
          runningSessionIds={runningSessionIds}
          unreadSessionIds={unreadSessionIds}
          homeDir={homeDir}
          onSelectSession={onSelectSession}
          onRenamed={onRefreshSessions}
          onSessionDeleted={(id) => onSessionDeleted?.(id)}
          foldedSessionIds={foldedSessionIds}
          onToggleFold={onToggleFold}
        />
      </div>

      <div
        style={{
          padding: "12px 4px 0 4px",
          borderTop: "1px solid var(--fx-line-subtle)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexShrink: 0,
        }}
      >
        <SettingsButton label={t("settings", "Settings")} active={settingsOpen} onClick={onOpenSettings} />
        <span
          className="type-mono-meta"
          style={{
            flex: 1,
            minWidth: 0,
            textAlign: "right",
            color: "var(--fx-text-tertiary)",
            userSelect: "none",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {`v${APP_VERSION}`}
        </span>
        {updateAvailable && (
          <UpdateButton label={t("sidebarUpdateAvailable", "Update available")} onClick={onOpenUpdate} />
        )}
      </div>
    </nav>
  );
}
