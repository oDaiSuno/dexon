import { useEffect, useState, type ReactNode } from "react";
import { useI18n } from "@/i18n";
import type { PulseModel, PulseRow } from "@/lib/sidebar-activity";
import {
  PULSE_ACTIVITIES,
  type SessionActivityCounts,
  type PulseActivity,
  type PulseActivityCounts,
} from "@/lib/session-tree-status";
import type { SessionInfo } from "@/lib/types";
import { ACTIVITY_TONE, activityCountsPhrase } from "../session-sidebar/session-status-indicators";
import { ExpandChevronGlyph } from "../session-sidebar/session-relation-glyphs";

import { ActivityGlyph, PulseWellRow } from "./pulse-well-row";

export const PULSE_WELL_MAX_VISIBLE_ROWS = 3;

export type PulseWellPreference = "expanded" | "collapsed";

export type PulseWellFace =
  | { readonly kind: "hidden" }
  | {
      readonly kind: "summary";
      readonly status: PulseActivity;
      readonly counts: Readonly<PulseActivityCounts>;
      readonly projectNames: readonly string[];
      readonly yieldedForSearch: boolean;
    }
  | {
      readonly kind: "expanded";
      readonly counts: Readonly<PulseActivityCounts>;
      readonly totalActiveSessions: number;
      readonly visibleRows: readonly PulseRow[];
      readonly overflowCount: number;
      readonly showAll: boolean;
    };

function toPulseCounts(model: PulseModel): PulseActivityCounts {
  return {
    ...model.sessionCounts,
    unread: model.rows.reduce((total, row) => total + Number(row.status === "unread"), 0),
  };
}

export function pulseWellFace(
  model: PulseModel,
  view: { preference: PulseWellPreference; showAll: boolean; searching: boolean },
): PulseWellFace {
  const counts = toPulseCounts(model);
  const status = PULSE_ACTIVITIES.find((candidate) => counts[candidate] > 0);
  if (!status) return { kind: "hidden" };
  if (view.searching || view.preference === "collapsed")
    return {
      kind: "summary",
      status,
      counts,
      projectNames: [...new Set(model.projectNames)],
      yieldedForSearch: view.searching,
    };
  return {
    kind: "expanded",
    counts,
    totalActiveSessions: PULSE_ACTIVITIES.reduce((total, candidate) => total + counts[candidate], 0),
    visibleRows: view.showAll ? model.rows : model.rows.slice(0, PULSE_WELL_MAX_VISIBLE_ROWS),
    overflowCount: Math.max(0, model.rows.length - PULSE_WELL_MAX_VISIBLE_ROWS),
    showAll: view.showAll,
  };
}

export function pulseSummaryPhrase(
  counts: Readonly<SessionActivityCounts & { unread?: number }>,
  t: (key: string, fallback: string) => string,
): string {
  const phrases: Record<PulseActivity, string> = {
    awaiting_input: t("pulseCountWaiting", "{count} wait"),
    error: t("pulseCountError", "{count} error"),
    running: t("pulseCountRunning", "{count} run"),
    unread: t("pulseCountUnread", "{count} unread"),
  };
  return PULSE_ACTIVITIES.filter((status) => (counts[status] ?? 0) > 0)
    .map((status) => phrases[status].replace("{count}", String(counts[status] ?? 0)))
    .join(" · ");
}

export function RecessedPulseWell({
  model,
  searching,
  visible = true,
  selectedSessionId,
  onOpenSession,
}: {
  model: PulseModel;
  searching: boolean;
  visible?: boolean;
  selectedSessionId: string | null;
  onOpenSession: (session: SessionInfo) => void;
}): ReactNode {
  const { t } = useI18n();
  const [preference, setPreference] = useState<PulseWellPreference>("expanded");
  const [showAll, setShowAll] = useState(false);
  const face = pulseWellFace(model, { preference, searching, showAll });
  const needsClock =
    visible &&
    face.kind === "expanded" &&
    face.visibleRows.some(
      (row) =>
        row.status === "running" &&
        (row.runAge.kind === "observed" || (row.runAge.kind === "unknown" && row.runAge.fallbackModifiedMs !== null)),
    );
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!needsClock) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const syncVisibility = () => {
      if (document.visibilityState === "hidden") {
        clearInterval(timer);
        timer = undefined;
      } else if (timer === undefined) {
        setNow(Date.now());
        timer = setInterval(() => setNow(Date.now()), 15_000);
      }
    };
    syncVisibility();
    document.addEventListener("visibilitychange", syncVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", syncVisibility);
    };
  }, [needsClock]);
  if (face.kind === "hidden") return null;
  if (face.kind === "summary")
    return (
      <section aria-label={t("pulseActiveSessions", "Active sessions")} style={{ flexShrink: 0 }}>
        <button
          type="button"
          aria-label={`${t("pulseExpand", "Expand active sessions")} · ${activityCountsPhrase(face.counts, t)}`}
          aria-description={`${activityCountsPhrase(face.counts, t)} · ${face.projectNames.join(" · ")}`}
          title={`${activityCountsPhrase(face.counts, t)} · ${face.projectNames.join(" · ")}`}
          aria-expanded={false}
          aria-disabled={face.yieldedForSearch || undefined}
          onClick={() => {
            if (!face.yieldedForSearch) setPreference("expanded");
          }}
          style={{
            display: "flex",
            alignItems: "center",
            width: "100%",
            height: 28,
            boxSizing: "border-box",
            padding: "0 10px",
            gap: 6,
            borderRadius: "var(--radius-control)",
            background: "var(--fx-surface-inset)",
            border: `1px solid ${ACTIVITY_TONE[face.status].border}`,
            cursor: face.yieldedForSearch ? "default" : "pointer",
            textAlign: "left",
          }}
        >
          <ActivityGlyph status={face.status} size={12} />
          <span
            className="type-label-medium"
            style={{
              flexShrink: 1,
              maxWidth: "45%",
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              color: "var(--fx-text-primary)",
            }}
          >
            {pulseSummaryPhrase(face.counts, t)}
          </span>
          <span
            className="type-mono-meta"
            style={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              color: "var(--fx-text-tertiary)",
            }}
          >
            {face.projectNames.join(" · ")}
          </span>
          <span aria-hidden="true" style={{ display: "inline-flex", color: "var(--fx-text-tertiary)" }}>
            <ExpandChevronGlyph size={13} />
          </span>
        </button>
      </section>
    );
  return (
    <section
      aria-label={t("pulseActiveSessions", "Active sessions")}
      style={{
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        maxHeight: "50%",
        minHeight: 0,
        padding: 5,
        gap: 1,
        borderRadius: "var(--radius-card)",
        background: "var(--fx-surface-inset)",
        border: "1px solid var(--fx-line-subtle)",
      }}
    >
      <button
        type="button"
        aria-label={t("pulseCollapse", "Collapse active sessions")}
        aria-description={activityCountsPhrase(face.counts, t)}
        aria-expanded={true}
        onClick={() => setPreference("collapsed")}
        style={{
          display: "flex",
          alignItems: "center",
          height: 22,
          boxSizing: "border-box",
          flexShrink: 0,
          padding: "2px 6px 3px",
          gap: 6,
          border: 0,
          background: "transparent",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span
          aria-hidden="true"
          style={{ width: 6, height: 6, borderRadius: 3, background: ACTIVITY_TONE.running.dot }}
        />
        <span className="type-label-medium" style={{ color: "var(--fx-text-primary)" }}>
          {t("pulseActiveSessions", "Active sessions")}
        </span>
        <span className="type-mono-meta" style={{ flex: 1, color: "var(--fx-text-tertiary)" }}>
          {face.totalActiveSessions}
        </span>
        <span
          aria-hidden="true"
          style={{ display: "inline-flex", transform: "rotate(180deg)", color: "var(--fx-text-tertiary)" }}
        >
          <ExpandChevronGlyph size={13} />
        </span>
      </button>
      <div style={{ display: "flex", flexDirection: "column", gap: 1, minHeight: 0, overflowY: "auto" }}>
        {face.visibleRows.map((row) => (
          <PulseWellRow
            key={row.key}
            row={row}
            now={now}
            selected={row.target.id === selectedSessionId}
            onOpen={onOpenSession}
          />
        ))}
      </div>
      {face.overflowCount > 0 && (
        <button
          type="button"
          aria-label={
            face.showAll ? t("pulseShowLess", "Show fewer active tasks") : t("pulseShowAll", "Show all active tasks")
          }
          onClick={() => setShowAll((current) => !current)}
          style={{
            display: "flex",
            alignItems: "center",
            flexShrink: 0,
            height: 24,
            boxSizing: "border-box",
            padding: "2px 8px 0",
            gap: 6,
            border: 0,
            borderTop: "1px solid var(--fx-line-default)",
            background: "transparent",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <span className="type-meta-default" style={{ flex: 1, color: "var(--fx-text-tertiary)" }}>
            {face.showAll
              ? t("pulseAllTasks", "All active tasks")
              : t("pulseMoreTasks", "{count} more background tasks").replace("{count}", String(face.overflowCount))}
          </span>
          <span className="type-mono-meta" style={{ color: "var(--fx-text-secondary)" }}>
            {face.showAll ? t("pulseLess", "Less") : t("pulseAll", "Show all")}
          </span>
        </button>
      )}
    </section>
  );
}
