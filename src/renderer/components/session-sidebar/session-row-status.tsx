import type { SessionActivityStatus, SessionRelation } from "@shared/session-orchestration";
import type { CountedActivity, SessionActivityCounts, SubtreeActivity } from "@/lib/session-tree-status";
import { COUNTED_ACTIVITIES } from "@/lib/session-tree-status";
import {
  AwaitingInputSessionIndicator,
  FailedTurnSessionIndicator,
  RunningSessionIndicator,
  UnreadSessionIndicator,
} from "./session-status-indicators";
import { SessionRelationGlyph } from "./session-relation-glyphs";

type Translate = (key: string, fallback: string) => string;

const COUNT_COLORS: Record<CountedActivity, string> = {
  awaiting_input: "var(--fx-status-warning)",
  error: "var(--fx-status-danger)",
  running: "var(--fx-accent-blue)",
};

export function sessionStatusPhrase(status: SessionActivityStatus, t: Translate): string | null {
  if (status === "awaiting_input") return t("sessionStatusAwaitingInput", "Waiting for your answer");
  if (status === "error") return t("sessionStatusError", "Last turn failed");
  if (status === "running") return t("agentRunningStatus", "Agent running");
  if (status === "unread") return t("newSessionActivity", "New activity");
  return null;
}

function countPhrase(activity: CountedActivity, count: number, t: Translate): string {
  if (activity === "awaiting_input")
    return t("sessionCountAwaitingInput", "{count} waiting for your answer").replace("{count}", String(count));
  if (activity === "error") return t("sessionCountError", "{count} failed").replace("{count}", String(count));
  return t("sessionCountRunning", "{count} running").replace("{count}", String(count));
}

function relationPhrase(relation: SessionRelation, t: Translate): string {
  return relation === "delegate"
    ? t("sessionRelationDelegate", "Created by session")
    : t("sessionRelationFork", "Forked session");
}

function countedPhrases(counts: SessionActivityCounts, t: Translate): string {
  return COUNTED_ACTIVITIES.filter((activity) => counts[activity] > 0)
    .map((activity) => countPhrase(activity, counts[activity], t))
    .join(", ");
}

export function sessionRowLabel({
  title,
  activity,
  relation,
  descendants,
  t,
}: {
  title: string;
  activity: SessionActivityStatus;
  relation: SessionRelation | null;
  descendants: SubtreeActivity | null;
  t: Translate;
}): string {
  const parts = [title];
  const own = sessionStatusPhrase(activity, t);
  if (own) parts.push(own);
  if (relation) parts.push(relationPhrase(relation, t));
  if (descendants) {
    if (descendants.status && descendants.status !== activity) {
      const summary = sessionStatusPhrase(descendants.status, t);
      if (summary) parts.push(summary);
    }
    const counts = countedPhrases(descendants.counts, t);
    if (counts) parts.push(counts);
  }
  return parts.join(" · ");
}

export function SessionRowStatusSlot({
  activity,
  relation,
  isSelected,
}: {
  activity: SessionActivityStatus;
  relation: SessionRelation | null;
  isSelected: boolean;
}) {
  if (activity === "awaiting_input") return <AwaitingInputSessionIndicator />;
  if (activity === "error") return <FailedTurnSessionIndicator />;
  if (activity === "running") return <RunningSessionIndicator />;
  if (activity === "unread") return <UnreadSessionIndicator />;
  if (relation) return <SessionRelationGlyph relation={relation} />;
  if (isSelected)
    return (
      <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: "var(--fx-text-primary)" }} />
    );
  return null;
}

function CountGlyph({ activity }: { activity: CountedActivity }) {
  const color = COUNT_COLORS[activity];
  const shared = {
    width: 9,
    height: 9,
    viewBox: "0 0 12 12",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    "aria-hidden": true,
    style: { display: "block", color },
  };
  if (activity === "awaiting_input")
    return (
      <svg {...shared}>
        <path d="M4.2 4.4a1.9 1.9 0 1 1 3.5 1.1c-.4.6-1.7 1.1-1.7 2.2" />
        <circle cx="6" cy="9.9" r="0.6" fill="currentColor" stroke="none" />
      </svg>
    );
  if (activity === "error")
    return (
      <svg {...shared}>
        <line x1="6" y1="2.6" x2="6" y2="7" />
        <circle cx="6" cy="9.4" r="0.6" fill="currentColor" stroke="none" />
      </svg>
    );
  return (
    <svg {...shared}>
      <circle cx="6" cy="6" r="4.2" strokeDasharray="19.8 6.6" transform="rotate(-90 6 6)" />
    </svg>
  );
}

export function SessionRowCounts({ counts }: { counts: SessionActivityCounts }) {
  const present = COUNTED_ACTIVITIES.filter((activity) => counts[activity] > 0);
  if (present.length === 0) return null;
  return (
    <span
      data-session-row-counts
      aria-hidden="true"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        flexShrink: 0,
        fontSize: "var(--text-meta)",
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
      }}
    >
      {present.map((activity, index) => (
        <span key={activity} style={{ display: "inline-flex", alignItems: "center", gap: 1 }}>
          {index > 0 && <span style={{ color: "var(--fx-text-tertiary)" }}>·</span>}
          <CountGlyph activity={activity} />
          <span style={{ color: COUNT_COLORS[activity] }}>{counts[activity]}</span>
        </span>
      ))}
    </span>
  );
}
