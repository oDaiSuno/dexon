import type { SessionActivityStatus, SessionRelation } from "@shared/session-orchestration";
import type { CountedActivity, SessionActivityCounts, SubtreeActivity } from "@/lib/session-tree-status";
import { COUNTED_ACTIVITIES } from "@/lib/session-tree-status";
import {
  AlertGlyph,
  AwaitingInputSessionIndicator,
  FailedTurnSessionIndicator,
  LoaderGlyph,
  QuestionGlyph,
  RunningSessionIndicator,
  UnreadSessionIndicator,
} from "./session-status-indicators";
import { SessionMessageGlyph, SessionRelationGlyph } from "./session-relation-glyphs";

type Translate = (key: string, fallback: string) => string;

const COUNT_COLORS: Record<CountedActivity, string> = {
  awaiting_input: "var(--fx-status-warning)",
  error: "var(--fx-status-danger)",
  running: "var(--fx-accent-blue-text)",
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

function leadTone(relation: SessionRelation | null, activity: SessionActivityStatus): string {
  if (relation === "delegate") return activity === "running" ? "var(--fx-accent-blue-text)" : "var(--fx-text-tertiary)";
  if (relation === "fork") return "var(--fx-text-secondary)";
  return "var(--fx-text-tertiary)";
}

export function SessionRowLead({
  activity,
  relation,
}: {
  activity: SessionActivityStatus;
  relation: SessionRelation | null;
}) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 14,
        height: 14,
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color: leadTone(relation, activity),
      }}
    >
      {relation ? <SessionRelationGlyph relation={relation} /> : <SessionMessageGlyph />}
    </span>
  );
}

export function sessionRowTitleClass({
  activity,
  relation,
  isSelected,
}: {
  activity: SessionActivityStatus;
  relation: SessionRelation | null;
  isSelected: boolean;
}): { className: string; color: string } {
  if (isSelected || activity === "awaiting_input" || activity === "unread")
    return { className: "type-body-large-medium", color: "var(--fx-text-primary)" };
  if (relation === "delegate")
    return {
      className: "type-body-default",
      color: activity === "running" ? "var(--fx-text-body)" : "var(--fx-text-secondary)",
    };
  if (relation === "fork") return { className: "type-body-default", color: "var(--fx-text-body)" };
  return { className: "type-body-large", color: "var(--fx-text-body)" };
}

export function sessionRowShowsTime(activity: SessionActivityStatus): boolean {
  return activity !== "running" && activity !== "awaiting_input" && activity !== "error";
}

export function SessionRowStatusSlot({ activity }: { activity: SessionActivityStatus }) {
  if (activity === "awaiting_input") return <AwaitingInputSessionIndicator />;
  if (activity === "error") return <FailedTurnSessionIndicator />;
  if (activity === "running") return <RunningSessionIndicator />;
  if (activity === "unread") return <UnreadSessionIndicator />;
  return null;
}

function CountGlyph({ activity }: { activity: CountedActivity }) {
  const color = COUNT_COLORS[activity];
  return (
    <span style={{ display: "inline-flex", color }}>
      {activity === "awaiting_input" ? (
        <QuestionGlyph size={11} />
      ) : activity === "error" ? (
        <AlertGlyph size={11} />
      ) : (
        <LoaderGlyph size={11} />
      )}
    </span>
  );
}

export function SessionRowCounts({ counts }: { counts: SessionActivityCounts }) {
  const present = COUNTED_ACTIVITIES.filter((activity) => counts[activity] > 0);
  if (present.length === 0) return null;
  return (
    <span
      data-session-row-counts
      aria-hidden="true"
      className="type-mono-meta"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        flexShrink: 0,
        padding: "0 6px",
        borderRadius: "var(--radius-pill)",
        background: "var(--fx-surface-card)",
        color: "var(--fx-text-secondary)",
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
      }}
    >
      {present.map((activity) => (
        <span key={activity} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
          <CountGlyph activity={activity} />
          <span>{counts[activity]}</span>
        </span>
      ))}
    </span>
  );
}
