import {
  SESSION_ACTIVITY_URGENCY,
  type SessionActivityStatus,
  type SessionLiveStatus,
} from "@shared/session-orchestration";
import type { SessionTreeNode } from "./session-tree";

export interface SessionActivitySignals {
  liveStatuses: Record<string, SessionLiveStatus>;
  runningSessionIds: ReadonlySet<string>;
  unreadSessionIds: ReadonlySet<string>;
}

export type CountedActivity = Extract<SessionActivityStatus, "awaiting_input" | "error" | "running">;

export type SessionActivityCounts = Record<CountedActivity, number>;

export interface SubtreeActivity {
  status: SessionActivityStatus | null;
  counts: SessionActivityCounts;
}

export const COUNTED_ACTIVITIES: CountedActivity[] = ["awaiting_input", "error", "running"];

export function isCountedActivity(status: SessionActivityStatus): status is CountedActivity {
  return status === "awaiting_input" || status === "error" || status === "running";
}

export function ownActivity(sessionId: string, signals: SessionActivitySignals): SessionActivityStatus {
  const live = signals.liveStatuses[sessionId];
  if (live) return live;
  if (signals.runningSessionIds.has(sessionId)) return "running";
  if (signals.unreadSessionIds.has(sessionId)) return "unread";
  return "idle";
}

function mostUrgent(left: SessionActivityStatus | null, right: SessionActivityStatus): SessionActivityStatus {
  if (!left) return right;
  return SESSION_ACTIVITY_URGENCY.indexOf(right) < SESSION_ACTIVITY_URGENCY.indexOf(left) ? right : left;
}

function collect(node: SessionTreeNode, signals: SessionActivitySignals, summary: SubtreeActivity): void {
  for (const child of node.children) {
    const activity = ownActivity(child.session.id, signals);
    if (activity !== "idle") summary.status = mostUrgent(summary.status, activity);
    if (isCountedActivity(activity)) summary.counts[activity] += 1;
    collect(child, signals, summary);
  }
}

export function descendantActivity(node: SessionTreeNode, signals: SessionActivitySignals): SubtreeActivity {
  const summary: SubtreeActivity = { status: null, counts: { awaiting_input: 0, error: 0, running: 0 } };
  collect(node, signals, summary);
  return summary;
}
