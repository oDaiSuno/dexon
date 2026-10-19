import { useRef, useState, type ReactNode } from "react";
import type { SessionInfo } from "@/lib/types";
import { useI18n } from "@/i18n";
import { NavSpaceMenu, PanelLeftIcon } from "./nav-space-menu";
import { NavHistory } from "./nav-history";
import { GlideHighlight } from "../chat-input/GlideHighlight";
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

const ENTRY_ROW_HEIGHT = 30;

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
        background: active ? "var(--bg-selected)" : "transparent",
        border: "none",
        borderRadius: "var(--radius-control)",
        color: active ? "var(--text)" : "var(--text-muted)",
        cursor: "pointer",
        transition:
          "background var(--duration-quick, 150ms) var(--ease-smooth-out, ease), color var(--duration-quick, 150ms) var(--ease-smooth-out, ease)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--bg-hover)";
        e.currentTarget.style.color = "var(--text)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = active ? "var(--bg-selected)" : "transparent";
        e.currentTarget.style.color = active ? "var(--text)" : "var(--text-muted)";
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
  const entryListRef = useRef<HTMLDivElement>(null);

  if (!expanded) {
    return (
      <nav
        aria-label={t("mainNavigation", "Main navigation")}
        className="app-nav"
        style={{
          width: NAV_RAIL_WIDTH,
          background: "var(--bg-panel)",
          borderRight: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          height: "100%",
          overflow: "hidden",
          flexShrink: 0,
          padding: "8px 0",
          gap: 6,
        }}
      >
        <RailButton label={t("showSidebar", "Show sidebar")} onClick={onToggleExpanded}>
          <PanelLeftIcon size={18} />
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
          <NewSessionIcon size={18} />
        </RailButton>
        <RailButton
          label={t("navPluginsSkills", "Plugins & Skills")}
          onClick={() => onNavigate("resources")}
          active={page === "resources"}
        >
          <PluginsIcon size={18} />
        </RailButton>
        <span style={{ flex: 1 }} />
        <RailButton label={t("settings", "Settings")} onClick={onOpenSettings}>
          <SettingsIcon size={18} />
        </RailButton>
      </nav>
    );
  }

  const entries: MainEntry[] = [
    {
      id: "new-session",
      label: t("newSession", "New session"),
      icon: <NewSessionIcon size={15} />,
      onClick: onNewSession,
    },
    {
      id: "resources",
      label: t("navPluginsSkills", "Plugins & Skills"),
      icon: <PluginsIcon size={15} />,
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
        background: "var(--bg-panel)",
        borderRight: "1px solid var(--border)",
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

      {/* Main entries */}
      <div
        ref={entryListRef}
        style={{
          position: "relative",
          padding: "2px 8px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 2,
          flexShrink: 0,
        }}
      >
        {entries.map((entry, index) => {
          const current = entry.page === page;
          return (
            <button
              key={entry.id}
              type="button"
              data-nav-entry
              aria-label={entry.label}
              aria-current={current ? "page" : undefined}
              onMouseEnter={() => setActiveEntry(index)}
              onMouseLeave={() => setActiveEntry(-1)}
              onClick={entry.onClick}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                width: "100%",
                height: ENTRY_ROW_HEIGHT,
                padding: "0 10px",
                background: current ? "var(--bg-selected)" : "transparent",
                border: "none",
                borderRadius: "var(--radius-control)",
                color: current ? "var(--text)" : "var(--text-muted)",
                cursor: "pointer",
                fontSize: "var(--text-body)",
                fontWeight: current ? 500 : 400,
                textAlign: "left",
                position: "relative",
                zIndex: 1,
                transition:
                  "background var(--duration-quick, 150ms) var(--ease-smooth-out, ease), color var(--duration-quick, 150ms) var(--ease-smooth-out, ease)",
              }}
            >
              <span
                aria-hidden="true"
                style={{ display: "inline-flex", width: 15, height: 15, flexShrink: 0, color: "var(--text-dim)" }}
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
        <GlideHighlight
          containerRef={entryListRef}
          rowSelector="[data-nav-entry]"
          activeIndex={activeEntry}
          visible={activeEntry >= 0}
        />
      </div>

      <div
        style={{
          borderTop: "1px solid var(--border)",
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

      <div style={{ padding: "6px 8px 8px", flexShrink: 0 }}>
        <button
          type="button"
          onClick={onOpenSettings}
          title={t("settings", "Settings")}
          aria-label={t("settings", "Settings")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            width: "100%",
            height: ENTRY_ROW_HEIGHT,
            padding: "0 10px",
            background: "transparent",
            border: "none",
            borderRadius: "var(--radius-control)",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: "var(--text-body)",
            textAlign: "left",
            transition:
              "background var(--duration-quick, 150ms) var(--ease-smooth-out, ease), color var(--duration-quick, 150ms) var(--ease-smooth-out, ease)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--bg-hover)";
            e.currentTarget.style.color = "var(--text)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "var(--text-muted)";
          }}
        >
          <span
            aria-hidden="true"
            style={{ display: "inline-flex", width: 15, height: 15, flexShrink: 0, color: "var(--text-dim)" }}
          >
            <SettingsIcon size={15} />
          </span>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {t("settings", "Settings")}
          </span>
        </button>
      </div>
    </nav>
  );
}
