import { useTheme } from "@/hooks/useTheme";
import { useI18n } from "@/i18n";
import { getSessionDisplayTitle } from "@/lib/session-list";
import type { ReactNode } from "react";
import { QuickChannelBinding } from "../channels/QuickChannelBinding";
import { SessionIdentity } from "./session-identity";
import { SessionInfoPopover } from "./session-info-popover";
import type { SessionInfo } from "@/lib/types";
import type { ChannelsSnapshot } from "@shared/channel-types";
import type { SessionStatsInfo } from "@/lib/pi-types";
import type { SessionCopyFeedback, SessionCopyField, ContextUsageState } from "./use-session-info";

// Split from AppShell.tsx in Phase 2: the top bar's presentation. Owns no
// long-lived state; toggles, stats and the info popover arrive from the
// composition root.

export function TopBar({
  sidebarOpen,
  onToggleSidebar,
  showSidebarToggle,
  isMobile,
  selectedSession,
  channelSnapshot,
  onChannelSnapshotChange,
  activeTopPanel,
  onToggleTopPanel,
  sessionStats,
  contextUsage,
  copyFeedback,
  onCopyField,
  trailing,
  showChat,
}: {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  showSidebarToggle: boolean;
  isMobile: boolean;
  selectedSession: SessionInfo | null;
  channelSnapshot: ChannelsSnapshot;
  onChannelSnapshotChange: (snapshot: ChannelsSnapshot) => void;
  activeTopPanel: "session" | null;
  onToggleTopPanel: () => void;
  sessionStats: SessionStatsInfo | null;
  contextUsage: ContextUsageState | null;
  copyFeedback: SessionCopyFeedback | null;
  onCopyField: (field: SessionCopyField, value: string) => void;
  trailing?: ReactNode;
  showChat: boolean;
}) {
  const { isDark, toggleTheme } = useTheme();
  const { language, t } = useI18n();

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        flexShrink: 0,
        borderBottom: "1px solid var(--fx-line-default)",
        height: 44,
        background: "var(--fx-surface-raised)",
        position: "relative",
        zIndex: 2,
      }}
    >
      {showSidebarToggle && (
        <button
          onClick={onToggleSidebar}
          title={sidebarOpen ? t("hideSidebar", "Hide sidebar") : t("showSidebar", "Show sidebar")}
          aria-label={sidebarOpen ? t("hideSidebar", "Hide sidebar") : t("showSidebar", "Show sidebar")}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 36,
            height: 36,
            padding: 0,
            background: "none",
            border: "none",
            borderRight: "1px solid var(--fx-line-default)",
            color: "var(--fx-text-secondary)",
            cursor: "pointer",
            flexShrink: 0,
            transition: "color 0.12s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "var(--fx-text-primary)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "var(--fx-text-secondary)";
          }}
        >
          {sidebarOpen ? (
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="9" y1="3" x2="9" y2="21" />
            </svg>
          ) : (
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          )}
        </button>
      )}
      <button
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          toggleTheme({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
        }}
        title={isDark ? t("switchToLight", "Switch to light mode") : t("switchToDark", "Switch to dark mode")}
        aria-label={isDark ? t("switchToLight", "Switch to light mode") : t("switchToDark", "Switch to dark mode")}
        aria-pressed={isDark}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 36,
          height: 36,
          padding: 0,
          background: "none",
          border: "none",
          borderRight: "1px solid var(--fx-line-default)",
          color: "var(--fx-text-secondary)",
          cursor: "pointer",
          flexShrink: 0,
          transition: "color 0.12s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "var(--fx-text-primary)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "var(--fx-text-secondary)";
        }}
      >
        {isDark ? (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="5" />
            <line x1="12" y1="1" x2="12" y2="3" />
            <line x1="12" y1="21" x2="12" y2="23" />
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
            <line x1="1" y1="12" x2="3" y2="12" />
            <line x1="21" y1="12" x2="23" y2="12" />
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
          </svg>
        ) : (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        )}
      </button>
      {selectedSession && !isMobile && (
        <div
          role="heading"
          aria-level={1}
          title={getSessionDisplayTitle(selectedSession, 240)}
          style={{
            flex: "1 1 auto",
            minWidth: 0,
            padding: "0 12px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: "var(--fx-text-primary)",
            fontSize: "var(--text-body)",
            fontWeight: 650,
          }}
        >
          {getSessionDisplayTitle(selectedSession)}
        </div>
      )}
      {selectedSession && (
        <QuickChannelBinding
          sessionId={selectedSession.id}
          snapshot={channelSnapshot}
          isMobile={isMobile}
          onSnapshotChange={onChannelSnapshotChange}
        />
      )}
      {/* Session stats — right-aligned in top bar */}
      {showChat &&
        (() => {
          const tokenStats = sessionStats?.tokens;
          const c = sessionStats?.cost ?? 0;
          const fmt = (n: number) =>
            n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n);
          let ctxColor = "var(--fx-text-secondary)";
          let ctxStr: string | null = null;
          if (contextUsage?.contextWindow) {
            const pct = contextUsage.percent;
            if (pct !== null && pct > 90) ctxColor = "var(--fx-status-danger)";
            else if (pct !== null && pct > 70) ctxColor = "var(--fx-status-warning)";
            ctxStr =
              pct !== null
                ? `${pct.toFixed(0)}% / ${fmt(contextUsage.contextWindow)}`
                : `? / ${fmt(contextUsage.contextWindow)}`;
          }

          const tooltipParts: string[] = [];
          if (tokenStats) {
            tooltipParts.push(`${t("usageInput", "Input")}: ${tokenStats.input.toLocaleString(language)}`);
            tooltipParts.push(`${t("usageOutput", "Output")}: ${tokenStats.output.toLocaleString(language)}`);
            tooltipParts.push(`${t("cacheRead", "Cache read")}: ${tokenStats.cacheRead.toLocaleString(language)}`);
            tooltipParts.push(`${t("cacheWrite", "Cache write")}: ${tokenStats.cacheWrite.toLocaleString(language)}`);
            if (c > 0) tooltipParts.push(`${t("usageCost", "Cost")}: $${c.toFixed(4)}`);
          }
          if (contextUsage?.contextWindow) {
            const pct = contextUsage.percent;
            tooltipParts.push(
              `${t("usageContext", "Context")}: ${pct !== null ? pct.toFixed(1) + "%" : t("unknown", "unknown")} / ${contextUsage.contextWindow.toLocaleString(language)} ${t("tokens", "tokens")}`,
            );
            if (pct === null)
              tooltipParts.push(
                t(
                  "contextUsagePendingHint",
                  "Context usage updates after the next model response (e.g. right after compaction)",
                ),
              );
          }
          const tooltip = tooltipParts.join("  |  ");

          return (
            <button
              type="button"
              onClick={onToggleTopPanel}
              title={tooltip || t("sessionInfo", "Session info")}
              aria-label={t("sessionInfo", "Session info")}
              aria-pressed={activeTopPanel === "session"}
              style={{
                marginLeft: "auto",
                display: "flex",
                alignItems: "center",
                gap: 8,
                paddingLeft: 12,
                paddingRight: 12,
                height: "100%",
                background: activeTopPanel === "session" ? "var(--bg-selected)" : "none",
                border: "none",
                borderTop: activeTopPanel === "session" ? "2px solid var(--fx-accent-blue)" : "2px solid transparent",
                fontSize: "var(--text-label)",
                color: "var(--fx-text-secondary)",
                whiteSpace: "nowrap",
                cursor: "pointer",
                fontVariantNumeric: "tabular-nums",
                transition: "color 0.1s, background 0.1s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "var(--fx-text-primary)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color =
                  activeTopPanel === "session" ? "var(--fx-text-primary)" : "var(--fx-text-secondary)";
              }}
            >
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
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              {!isMobile && tokenStats && tokenStats.total > 0 && (
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  {fmt(tokenStats.total)} {t("tokens", "tokens")}
                </span>
              )}
              {ctxStr && (
                <span style={{ display: "flex", alignItems: "center", gap: 4, color: ctxColor }}>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 10 10"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M1 9 L1 5 Q1 1 5 1 Q9 1 9 5 L9 9" />
                    <line x1="1" y1="9" x2="9" y2="9" />
                  </svg>
                  {ctxStr}
                </span>
              )}
            </button>
          );
        })()}
      {trailing && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexShrink: 0,
            marginLeft: showChat ? undefined : "auto",
            paddingRight: 16,
          }}
        >
          {showChat && (
            <span
              aria-hidden="true"
              style={{ width: 1, height: 16, background: "var(--fx-surface-selected)", flexShrink: 0 }}
            />
          )}
          {trailing}
        </div>
      )}
      {/* Top panel dropdown — shared, only one active at a time */}
      {activeTopPanel && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            maxHeight: "calc(100dvh - 44px)",
            overflowY: "auto",
            zIndex: 50,
          }}
        >
          {activeTopPanel === "session" && (
            <div
              className="session-info-popover composer-pop-in"
              style={{
                background: "var(--fx-surface-raised)",
                borderBottom: "1px solid var(--fx-line-default)",
                boxShadow: "0 10px 28px rgba(0,0,0,0.10)",
                padding: "12px 16px",
              }}
            >
              {sessionStats ? (
                <SessionInfoPopover
                  sessionStats={sessionStats}
                  contextUsage={contextUsage}
                  copyFeedback={copyFeedback}
                  onCopyField={onCopyField}
                  isMobile={isMobile}
                />
              ) : selectedSession ? (
                <SessionIdentity
                  sessionName={selectedSession.name}
                  sessionFile={selectedSession.path}
                  sessionId={selectedSession.id}
                  copyFeedback={copyFeedback}
                  onCopyField={onCopyField}
                />
              ) : (
                <div style={{ fontSize: "var(--text-label)", color: "var(--fx-text-secondary)", fontStyle: "italic" }}>
                  {t("loadSessionInfoHint", "Send a message or run /session to load session info")}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
