import { useRef, useState, type ReactNode } from "react";
import type { SessionInfo } from "@/lib/types";
import { useI18n } from "@/i18n";
import { NavSpaceMenu, PanelLeftIcon } from "./nav-space-menu";
import { NavHistory } from "./nav-history";
import { GlideHighlight } from "../chat-input/GlideHighlight";
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
        <RailButton label={t("newSession", "new session")} onClick={onNewSession}>
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </RailButton>
        <RailButton
          label={t("navPluginsSkills", "Plugins & Skills")}
          onClick={() => onNavigate("resources")}
          active={page === "resources"}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="3" width="7" height="7" rx="1.5" />
            <rect x="14" y="3" width="7" height="7" rx="1.5" />
            <rect x="3" y="14" width="7" height="7" rx="1.5" />
            <rect x="14" y="14" width="7" height="7" rx="1.5" />
          </svg>
        </RailButton>
        <span style={{ flex: 1 }} />
        <RailButton label={t("settings", "Settings")} onClick={onOpenSettings}>
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.12.38.33.72.6 1 .3.29.69.42 1.1.4h.09v4h-.09a1.7 1.7 0 0 0-1.7.6Z" />
          </svg>
        </RailButton>
      </nav>
    );
  }

  const entries = [
    {
      id: "chat" as const,
      label: t("navChat", "Chat"),
      icon: (
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />
        </svg>
      ),
    },
    {
      id: "resources" as const,
      label: t("navPluginsSkills", "Plugins & Skills"),
      icon: (
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
      ),
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

      {/* Main functions: the two approved primary pages */}
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
        {entries.map((entry, index) => (
          <button
            key={entry.id}
            type="button"
            data-nav-entry
            aria-label={entry.label}
            aria-current={page === entry.id ? "page" : undefined}
            onMouseEnter={() => setActiveEntry(index)}
            onMouseLeave={() => setActiveEntry(-1)}
            onClick={() => onNavigate(entry.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              width: "100%",
              height: ENTRY_ROW_HEIGHT,
              padding: "0 10px",
              background: page === entry.id ? "var(--bg-selected)" : "transparent",
              border: "none",
              borderRadius: "var(--radius-control)",
              color: page === entry.id ? "var(--text)" : "var(--text-muted)",
              cursor: "pointer",
              fontSize: "var(--text-body)",
              fontWeight: page === entry.id ? 500 : 400,
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
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {entry.label}
            </span>
          </button>
        ))}
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
          onNewSession={onNewSession}
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
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.12.38.33.72.6 1 .3.29.69.42 1.1.4h.09v4h-.09a1.7 1.7 0 0 0-1.7.6Z" />
            </svg>
          </span>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {t("settings", "Settings")}
          </span>
        </button>
      </div>
    </nav>
  );
}
