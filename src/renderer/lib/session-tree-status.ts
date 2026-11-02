import {
  SESSION_ACTIVITY_URGENCY,
  SESSION_LIVE_STATUSES,
  type SessionActivityStatus,
  type SessionLiveStatus,
} from "@shared/session-orchestration";
import type { SessionInfo } from "./types";
import type { SessionTreeNode } from "./session-tree";
import { sessionActivityFromLegacySignals } from "./session-activity-state";

export type RunAge =
  | { readonly kind: "not-running" }
  | { readonly kind: "observed"; readonly since: number }
  | { readonly kind: "unknown"; readonly fallbackModifiedMs: number | null };

export interface SessionActivity {
  of(sessionId: string): SessionActivityStatus;
  runAge(sessionId: string, fallbackModifiedIso?: string): RunAge;
}

export const NO_SESSION_ACTIVITY: SessionActivity = {
  of: () => "idle",
  runAge: () => ({ kind: "not-running" }),
};

export interface SessionActivitySignals {
  liveStatuses: Record<string, SessionLiveStatus>;
  runningSessionIds: ReadonlySet<string>;
  unreadSessionIds: ReadonlySet<string>;
}

export type CountedActivity = SessionLiveStatus;

export type SessionActivityCounts = Record<CountedActivity, number>;

export interface SubtreeActivity {
  status: SessionActivityStatus | null;
  counts: SessionActivityCounts;
  unread: number;
  focus: { session: SessionInfo; status: CountedActivity; runAge: RunAge } | null;
}

export function isCountedActivity(status: SessionActivityStatus): status is CountedActivity {
  return (SESSION_LIVE_STATUSES as readonly string[]).includes(status);
}

export const COUNTED_ACTIVITIES: readonly CountedActivity[] = SESSION_ACTIVITY_URGENCY.filter(isCountedActivity);

export function isWorkInFlight(status: SessionActivityStatus): status is "running" | "awaiting_input" {
  return status === "running" || status === "awaiting_input";
}

export function moreUrgent(left: SessionActivityStatus, right: SessionActivityStatus): SessionActivityStatus {
  return SESSION_ACTIVITY_URGENCY.indexOf(right) < SESSION_ACTIVITY_URGENCY.indexOf(left) ? right : left;
}

export function indicatedActivity(
  own: SessionActivityStatus,
  descendants: SubtreeActivity | null,
): SessionActivityStatus {
  const bubbled = descendants?.status;
  return bubbled && isCountedActivity(bubbled) ? moreUrgent(own, bubbled) : own;
}

export function ownActivity(
  sessionId: string,
  signals: SessionActivitySignals | SessionActivity,
): SessionActivityStatus {
  if ("of" in signals) return signals.of(sessionId);
  const live = signals.liveStatuses[sessionId];
  if (live) return live;
  if (signals.runningSessionIds.has(sessionId)) return "running";
  if (signals.unreadSessionIds.has(sessionId)) return "unread";
  return "idle";
}

function collect(node: SessionTreeNode, signals: SessionActivity, summary: SubtreeActivity): void {
  for (const child of node.children) {
    const activity = signals.of(child.session.id);
    if (activity !== "idle") summary.status = summary.status ? moreUrgent(summary.status, activity) : activity;
    if (activity === "unread") summary.unread += 1;
    if (isCountedActivity(activity)) {
      summary.counts[activity] += 1;
      if (!summary.focus || moreUrgent(summary.focus.status, activity) !== summary.focus.status) {
        summary.focus = {
          session: child.session,
          status: activity,
          runAge: signals.runAge(child.session.id, child.session.modified),
        };
      }
    }
    collect(child, signals, summary);
  }
}

export function descendantActivity(
  node: SessionTreeNode,
  signals: SessionActivitySignals | SessionActivity,
): SubtreeActivity {
  const summary: SubtreeActivity = {
    status: null,
    counts: { awaiting_input: 0, error: 0, running: 0 },
    unread: 0,
    focus: null,
  };
  collect(node, "of" in signals ? signals : sessionActivityFromLegacySignals(signals), summary);
  return summary;
}
