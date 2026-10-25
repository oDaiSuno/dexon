import { useI18n } from "@/i18n";
import { useEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from "react";
import { formatTokenCount } from "../chat-input/SessionControls";
import { PathChevron, ProjectGlyph, SessionBreadcrumb, SessionTitle } from "./session-breadcrumb";
import { UsageCard } from "./session-info-popover";
import { formatUsageCost, formatUsagePercent } from "./usage-format";
import type { SessionInfo } from "@/lib/types";
import type { SessionStatsInfo } from "@/lib/pi-types";
import type { SessionCopyFeedback, SessionCopyField, ContextUsageState, UsageCompaction } from "./use-session-info";

const ICON_BUTTON: CSSProperties = {
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

function Separator({ height }: { height: number }) {
  return (
    <span aria-hidden="true" style={{ width: 1, height, flexShrink: 0, background: "var(--fx-surface-selected)" }} />
  );
}

function Meter({ percent, tone }: { percent: number; tone: string }) {
  return (
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
          background: tone,
        }}
      />
    </span>
  );
}

function UsageCapsule({
  open,
  onToggle,
  label,
  title,
  cost,
  hasStats,
  percent,
  alertTone,
  usedTokens,
  contextWindow,
  showWindow,
  buttonRef,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  title: string;
  cost: number;
  hasStats: boolean;
  percent: number | null;
  alertTone: string | null;
  usedTokens: number | null;
  contextWindow: number | null;
  showWindow: boolean;
  buttonRef: RefObject<HTMLButtonElement | null>;
}) {
  const meterTone = alertTone ?? "var(--fx-text-body)";
  const resting = open ? "var(--fx-surface-selected)" : "var(--fx-surface-hover-clear)";

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onToggle}
      title={title}
      aria-label={label}
      aria-expanded={open}
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
        background: resting,
        color: "var(--fx-text-secondary)",
        whiteSpace: "nowrap",
        cursor: "pointer",
        transition: "background 0.15s",
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = "var(--fx-surface-hover-overlay)";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = resting;
      }}
    >
      <CoinsGlyph />
      {hasStats && <span style={{ color: "var(--fx-text-secondary)" }}>{formatUsageCost(cost)}</span>}
      {percent !== null && (
        <>
          <Separator height={12} />
          <Meter percent={percent} tone={meterTone} />
          <span style={{ color: alertTone ?? "var(--fx-text-secondary)" }}>{formatUsagePercent(percent)}</span>
        </>
      )}
      {showWindow && contextWindow !== null && (
        <span style={{ color: "var(--fx-text-tertiary)" }}>
          {usedTokens !== null
            ? `${formatTokenCount(usedTokens)}/${formatTokenCount(contextWindow)}`
            : `?/${formatTokenCount(contextWindow)}`}
        </span>
      )}
      <CaretGlyph />
    </button>
  );
}

function SidebarToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { t } = useI18n();
  const label = open ? t("hideSidebar", "Hide sidebar") : t("showSidebar", "Show sidebar");

  return (
    <button
      type="button"
      onClick={onToggle}
      title={label}
      aria-label={label}
      style={ICON_BUTTON}
      onMouseEnter={(event) => {
        event.currentTarget.style.color = "var(--fx-text-primary)";
        event.currentTarget.style.background = "var(--fx-surface-hover-overlay)";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.color = "var(--fx-text-secondary)";
        event.currentTarget.style.background = "none";
      }}
    >
      {open ? (
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
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="9" y1="3" x2="9" y2="21" />
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
        >
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      )}
    </button>
  );
}

export function TopBar({
  sidebarOpen,
  onToggleSidebar,
  showSidebarToggle,
  isMobile,
  selectedSession,
  projectName,
  activeTopPanel,
  onToggleTopPanel,
  sessionStats,
  contextUsage,
  modelId,
  copyFeedback,
  onCopyField,
  compaction,
  trailing,
  showChat,
}: {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  showSidebarToggle: boolean;
  isMobile: boolean;
  selectedSession: SessionInfo | null;
  projectName?: string | null;
  activeTopPanel: "session" | null;
  onToggleTopPanel: () => void;
  sessionStats: SessionStatsInfo | null;
  contextUsage: ContextUsageState | null;
  modelId: string | null;
  copyFeedback: SessionCopyFeedback | null;
  onCopyField: (field: SessionCopyField, value: string) => void;
  compaction?: UsageCompaction | null;
  trailing?: ReactNode;
  showChat: boolean;
}) {
  const { language, t } = useI18n();
  const usageRef = useRef<HTMLDivElement | null>(null);
  const capsuleRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef(false);

  useEffect(() => {
    if (activeTopPanel !== "session") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      restoreFocusRef.current = true;
      onToggleTopPanel();
    };
    const onMouseDown = (event: MouseEvent) => {
      if (usageRef.current?.contains(event.target as Node)) return;
      onToggleTopPanel();
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [activeTopPanel, onToggleTopPanel]);

  useEffect(() => {
    if (activeTopPanel === "session" || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    capsuleRef.current?.focus();
  }, [activeTopPanel]);

  const percent = contextUsage?.percent ?? null;
  const contextWindow = contextUsage?.contextWindow ?? null;
  const usedTokens = contextUsage?.tokens ?? null;
  const cost = sessionStats?.cost ?? 0;
  const alertTone =
    percent === null
      ? null
      : percent > 90
        ? "var(--fx-status-danger)"
        : percent > 70
          ? "var(--fx-status-warning)"
          : null;

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
        padding: "0 16px 0 24px",
        borderBottom: "1px solid var(--fx-line-subtle)",
        background: "var(--fx-surface-main)",
        position: "relative",
        zIndex: 2,
      }}
    >
      {showSidebarToggle && <SidebarToggle open={sidebarOpen} onToggle={onToggleSidebar} />}

      {showChat && (
        <>
          {projectName && !isMobile && (
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
                {projectName}
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
        <div ref={usageRef} style={{ position: "relative", display: "flex", flexShrink: 0 }}>
          <UsageCapsule
            buttonRef={capsuleRef}
            open={activeTopPanel === "session"}
            onToggle={onToggleTopPanel}
            label={t("contextAndCost", "View context and cost")}
            title={tooltipParts.join("  |  ") || t("contextAndCost", "View context and cost")}
            cost={cost}
            hasStats={sessionStats !== null}
            percent={percent}
            alertTone={alertTone}
            usedTokens={usedTokens}
            contextWindow={contextWindow}
            showWindow={!isMobile}
          />
          {activeTopPanel === "session" && (
            <UsageCard
              sessionStats={sessionStats}
              contextUsage={contextUsage}
              modelId={modelId}
              selectedSession={selectedSession}
              copyFeedback={copyFeedback}
              onCopyField={onCopyField}
              compaction={compaction ?? null}
            />
          )}
        </div>
      )}

      {trailing && (
        <>
          {showChat && <Separator height={16} />}
          {trailing}
        </>
      )}
    </div>
  );
}
