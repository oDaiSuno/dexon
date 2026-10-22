import { useState, type ReactNode } from "react";
import type { SessionInfo } from "@/lib/types";
import type { SessionLiveStatus } from "@shared/session-orchestration";
import { useI18n } from "@/i18n";
import { NavSpaceMenu, PanelLeftIcon } from "./nav-space-menu";
import { NavHistory } from "./nav-history";
import { NewSessionIcon, PluginsIcon, SettingsIcon } from "./nav-icons";
import appIconUrl from "../../../../build/icon.png";
import { NAV_EXPANDED_WIDTH, NAV_RAIL_WIDTH } from "@/lib/layout-preferences";

// Phase 4 composition root of the new app navigation sidebar. Two states:
// the expanded 224px navigation (top space, main functions, history, bottom
// settings) and the collapsed 52px icon rail with exactly the four approved
// entries. Presentation only — data and actions arrive via props; the space
// coordination (Phase 6) and the production wiring (Phase 11) own the rest.

export { NAV_EXPANDED_WIDTH, NAV_RAIL_WIDTH };

export type NavPage = "chat" | "resources";

const ENTRY_ROW_HEIGHT = 36;
const NAV_ICON_SIZE = 18;

function RailButton({
  label,
  onClick,
  active = false,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 36,
        height: 36,
        padding: 0,
        flexShrink: 0,
        background: active ? "var(--fx-surface-selected)" : "transparent",
        border: `1px solid ${active ? "var(--fx-line-strong)" : "transparent"}`,
        borderRadius: "var(--radius-control)",
        color: active ? "var(--fx-text-primary)" : "var(--fx-text-secondary)",
        cursor: "pointer",
        transition:
          "background var(--duration-quick, 150ms) var(--ease-smooth-out, ease), color var(--duration-quick, 150ms) var(--ease-smooth-out, ease)",
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = "var(--fx-surface-hover)";
        e.currentTarget.style.color = "var(--fx-text-primary)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = active ? "var(--fx-surface-selected)" : "transparent";
        e.currentTarget.style.color = active ? "var(--fx-text-primary)" : "var(--fx-text-secondary)";
      }}
    >
      {children}
    </button>
  );
}

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
  onSessionDeleted,
  onOpenFolder,
  onChooseFolder,
  onSwitchSpace,
  onBackToPersonalSpace,
  spacePanel,
  foldedSessionIds,
  onToggleFold,
}: {
  expanded: boolean;
  page: NavPage;
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
  onSessionDeleted?: (id: string) => void;
  onOpenFolder: () => void;
  onChooseFolder: () => void;
  onSwitchSpace: () => void;
  onBackToPersonalSpace: () => void;
  spacePanel?: ReactNode;
  foldedSessionIds?: ReadonlySet<string>;
  onToggleFold?: (sessionId: string) => void;
}) {
  const { t } = useI18n();
  // The friendly space name defaults to the personal-space label (N05): the
  // space coordination (Phase 6) passes an explicit name when one exists.
  const spaceName = spaceNameProp ?? t("personalSpace", "Personal space");
  const [activeEntry, setActiveEntry] = useState(-1);

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
          active={page === "resources"}
        >
          <PluginsIcon size={NAV_ICON_SIZE} />
        </RailButton>
        <span style={{ flex: 1 }} />
        <RailButton label={t("settings", "Settings")} onClick={onOpenSettings}>
          <SettingsIcon size={NAV_ICON_SIZE} />
        </RailButton>
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
        borderRight: "1px solid var(--fx-line-subtle)",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      <NavSpaceMenu
        spaceName={spaceName}
        spacePath={spacePath}
        onToggleExpanded={onToggleExpanded}
        onOpenFolder={onOpenFolder}
        onChooseFolder={onChooseFolder}
        onSwitchSpace={onSwitchSpace}
        onBackToPersonalSpace={onBackToPersonalSpace}
      />
      {spacePanel}

      <div
        style={{
          padding: "var(--space-1) var(--space-3) var(--space-4)",
          display: "flex",
          flexDirection: "column",
          gap: 2,
          flexShrink: 0,
        }}
      >
        {entries.map((entry, index) => {
          const current = entry.page === page;
          const hovered = !current && activeEntry === index;
          return (
            <button
              key={entry.id}
              type="button"
              data-nav-entry
              aria-label={entry.label}
              aria-current={current ? "page" : undefined}
              className={current ? "type-body-large-medium" : "type-body-large"}
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
                background: current
                  ? "var(--fx-surface-selected)"
                  : hovered
                    ? "var(--fx-surface-hover)"
                    : "transparent",
                border: `1px solid ${current ? "var(--fx-line-strong)" : "transparent"}`,
                borderRadius: "var(--radius-control)",
                color: current ? "var(--fx-text-primary)" : "var(--fx-text-body)",
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
                  color: current ? "var(--fx-text-primary)" : "var(--fx-text-secondary)",
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
          loading={loading}
          error={error}
          selectedSessionId={selectedSessionId}
          liveStatuses={liveStatuses}
          runningSessionIds={runningSessionIds}
          unreadSessionIds={unreadSessionIds}
          homeDir={homeDir}
          onSelectSession={onSelectSession}
          onRenamed={onRefreshSessions}
          onSessionDeleted={(id) => onSessionDeleted?.(id)}
          onRefreshSessions={onRefreshSessions}
          foldedSessionIds={foldedSessionIds}
          onToggleFold={onToggleFold}
        />
      </div>

      <div
        style={{
          margin: "0 var(--space-3)",
          padding: "var(--space-3) 0 var(--space-4)",
          borderTop: "1px solid var(--fx-line-subtle)",
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={onOpenSettings}
          title={t("settings", "Settings")}
          aria-label={t("settings", "Settings")}
          className="type-body-large"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
            width: "100%",
            height: ENTRY_ROW_HEIGHT,
            padding: "0 10px",
            background: "transparent",
            border: "1px solid transparent",
            borderRadius: "var(--radius-control)",
            color: "var(--fx-text-body)",
            cursor: "pointer",
            textAlign: "left",
            transition:
              "background var(--duration-quick, 150ms) var(--ease-smooth-out, ease), color var(--duration-quick, 150ms) var(--ease-smooth-out, ease)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--fx-surface-hover)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
        >
          <span
            aria-hidden="true"
            style={{
              display: "inline-flex",
              width: NAV_ICON_SIZE,
              height: NAV_ICON_SIZE,
              flexShrink: 0,
              color: "var(--fx-text-secondary)",
            }}
          >
            <SettingsIcon size={NAV_ICON_SIZE} />
          </span>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {t("settings", "Settings")}
          </span>
        </button>
      </div>
    </nav>
  );
}
