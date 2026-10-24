import { useTheme } from "@/hooks/useTheme";
import { useI18n } from "@/i18n";
import { isPersonalSpace, spaceFolderName } from "@/lib/space-identity";
import type { CSSProperties, ReactNode } from "react";
import { PathChevron, ProjectGlyph, SessionBreadcrumb, SessionTitle } from "./session-breadcrumb";
import { SessionInfoPopover } from "./session-info-popover";
import { SessionIdentity } from "./session-identity";
import type { SessionInfo } from "@/lib/types";
import type { SessionStatsInfo } from "@/lib/pi-types";
import type { SessionCopyFeedback, SessionCopyField, ContextUsageState } from "./use-session-info";

const UTILITY_BUTTON: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 32,
  height: 32,
  padding: 0,
  flexShrink: 0,
  background: "none",
  border: "none",
  borderRadius: "var(--radius-control)",
  color: "var(--fx-text-secondary)",
  cursor: "pointer",
  transition: "color 0.12s, background 0.12s",
};

function compact(n: number) {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n);
}

function CoinsGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0, color: "var(--fx-text-tertiary)" }}
    >
      <circle cx="8" cy="8" r="6" />
      <path d="M18.09 10.37A6 6 0 1 1 10.34 18" />
      <path d="M7 6h1v4" />
      <path d="m16.71 13.88.7.71-2.82 2.82" />
    </svg>
  );
}

function CaretGlyph() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0, color: "var(--fx-text-tertiary)" }}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function TopBar({
  sidebarOpen,
  onToggleSidebar,
  showSidebarToggle,
  isMobile,
  selectedSession,
  projectPath,
  personalSpacePath,
  homeDir,
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
  projectPath?: string | null;
  personalSpacePath?: string | null;
  homeDir?: string | null;
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

  const projectLabel = projectPath
    ? isPersonalSpace(projectPath, personalSpacePath ?? null, homeDir ?? "")
      ? t("personalSpace", "Personal space")
      : spaceFolderName(projectPath)
    : null;
  const themeLabel = isDark ? t("switchToLight", "Switch to light mode") : t("switchToDark", "Switch to dark mode");

  const percent = contextUsage?.percent ?? null;
  const contextWindow = contextUsage?.contextWindow ?? null;
  const usedTokens = contextUsage?.tokens ?? null;
  const cost = sessionStats?.cost ?? 0;
  const percentTone =
    percent === null
      ? "var(--fx-text-secondary)"
      : percent > 90
        ? "var(--fx-status-danger)"
        : percent > 70
          ? "var(--fx-status-warning)"
          : "var(--fx-text-secondary)";
  const meterTone = percentTone === "var(--fx-text-secondary)" ? "var(--fx-text-body)" : percentTone;

  const tooltipParts: string[] = [];
  if (sessionStats) {
    tooltipParts.push(`${t("usageInput", "Input")}: ${sessionStats.tokens.input.toLocaleString(language)}`);
    tooltipParts.push(`${t("usageOutput", "Output")}: ${sessionStats.tokens.output.toLocaleString(language)}`);
    tooltipParts.push(`${t("cacheRead", "Cache read")}: ${sessionStats.tokens.cacheRead.toLocaleString(language)}`);
    tooltipParts.push(`${t("cacheWrite", "Cache write")}: ${sessionStats.tokens.cacheWrite.toLocaleString(language)}`);
    if (cost > 0) tooltipParts.push(`${t("usageCost", "Cost")}: $${cost.toFixed(4)}`);
  }
  if (contextWindow) {
    tooltipParts.push(
      `${t("usageContext", "Context")}: ${percent !== null ? `${percent.toFixed(1)}%` : t("unknown", "unknown")} / ${contextWindow.toLocaleString(language)} ${t("tokens", "tokens")}`,
    );
    if (percent === null)
      tooltipParts.push(
        t(
          "contextUsagePendingHint",
          "Context usage updates after the next model response (e.g. right after compaction)",
        ),
      );
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        flexShrink: 0,
        gap: 10,
        height: 56,
        padding: showSidebarToggle ? "0 16px 0 0" : "0 16px 0 24px",
        borderBottom: "1px solid var(--fx-line-subtle)",
        background: "var(--fx-surface-main)",
        position: "relative",
        zIndex: 2,
      }}
    >
      {showSidebarToggle && (
        <button
          type="button"
          onClick={onToggleSidebar}
          title={sidebarOpen ? t("hideSidebar", "Hide sidebar") : t("showSidebar", "Show sidebar")}
          aria-label={sidebarOpen ? t("hideSidebar", "Hide sidebar") : t("showSidebar", "Show sidebar")}
          style={{ ...UTILITY_BUTTON, width: 36, height: 36, borderRadius: 0 }}
          onMouseEnter={(event) => {
            event.currentTarget.style.color = "var(--fx-text-primary)";
            event.currentTarget.style.background = "var(--fx-surface-hover-overlay)";
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.color = "var(--fx-text-secondary)";
            event.currentTarget.style.background = "none";
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

      {showChat && projectLabel && (
        <>
          {!isMobile && (
            <>
              <ProjectGlyph />
              <span
                className="type-body-large"
                style={{
                  minWidth: 0,
                  maxWidth: 240,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  color: "var(--fx-text-secondary)",
                }}
              >
                {projectLabel}
              </span>
              <PathChevron />
            </>
          )}
          {selectedSession ? (
            <SessionBreadcrumb session={selectedSession} compact={isMobile} />
          ) : (
            <SessionTitle>{t("newSessionTitle", "New session")}</SessionTitle>
          )}
        </>
      )}

      <span style={{ flex: "1 1 auto" }} />

      {showChat && (
        <button
          type="button"
          onClick={onToggleTopPanel}
          title={tooltipParts.join("  |  ") || t("contextAndCost", "View context and cost")}
          aria-label={t("contextAndCost", "View context and cost")}
          aria-expanded={activeTopPanel === "session"}
          className="type-mono-label"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            height: 30,
            flexShrink: 0,
            boxSizing: "border-box",
            padding: "0 8px 0 10px",
            border: "none",
            borderRadius: "var(--radius-control)",
            background: activeTopPanel === "session" ? "var(--fx-surface-selected)" : "var(--fx-surface-hover-clear)",
            color: "var(--fx-text-secondary)",
            whiteSpace: "nowrap",
            cursor: "pointer",
            transition: "background 0.15s",
          }}
          onMouseEnter={(event) => {
            event.currentTarget.style.background = "var(--fx-surface-hover-overlay)";
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.background =
              activeTopPanel === "session" ? "var(--fx-surface-selected)" : "var(--fx-surface-hover-clear)";
          }}
        >
          <CoinsGlyph />
          {sessionStats && <span style={{ color: "var(--fx-text-secondary)" }}>{`$${cost.toFixed(2)}`}</span>}
          {percent !== null && (
            <>
              <span
                aria-hidden="true"
                style={{ width: 1, height: 12, flexShrink: 0, background: "var(--fx-surface-selected)" }}
              />
              <span
                aria-hidden="true"
                style={{
                  display: "flex",
                  width: 28,
                  height: 4,
                  flexShrink: 0,
                  overflow: "hidden",
                  borderRadius: "var(--radius-bar)",
                  background: "var(--fx-surface-track)",
                }}
              >
                <span
                  style={{
                    width: `${Math.max(0, Math.min(100, percent))}%`,
                    height: "100%",
                    borderRadius: "var(--radius-bar)",
                    background: meterTone,
                  }}
                />
              </span>
              <span style={{ color: percentTone }}>{`${percent.toFixed(0)}%`}</span>
            </>
          )}
          {contextWindow !== null && !isMobile && (
            <span style={{ color: "var(--fx-text-tertiary)" }}>
              {usedTokens !== null ? `${compact(usedTokens)}/${compact(contextWindow)}` : `?/${compact(contextWindow)}`}
            </span>
          )}
          <CaretGlyph />
        </button>
      )}

      {trailing && (
        <>
          {showChat && (
            <span
              aria-hidden="true"
              style={{ width: 1, height: 16, flexShrink: 0, background: "var(--fx-surface-selected)" }}
            />
          )}
          {trailing}
        </>
      )}

      <button
        type="button"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          toggleTheme({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
        }}
        title={themeLabel}
        aria-label={themeLabel}
        aria-pressed={isDark}
        style={UTILITY_BUTTON}
        onMouseEnter={(event) => {
          event.currentTarget.style.color = "var(--fx-text-primary)";
          event.currentTarget.style.background = "var(--fx-surface-hover-overlay)";
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.color = "var(--fx-text-secondary)";
          event.currentTarget.style.background = "none";
        }}
      >
        {isDark ? (
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
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
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        )}
      </button>

      {activeTopPanel && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            maxHeight: "calc(100dvh - 56px)",
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
                boxShadow: "var(--shadow-popover)",
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
                <div className="type-label-default" style={{ color: "var(--fx-text-secondary)", fontStyle: "italic" }}>
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
