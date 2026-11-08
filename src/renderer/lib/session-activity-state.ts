import { SESSION_LIVE_STATUSES, type SessionLiveStatus } from "@shared/session-orchestration";
import type { SessionActivity, SessionActivitySignals } from "./session-tree-status";
import type { SessionInfo } from "./types";

export type LiveStatusMap = ReadonlyMap<string, SessionLiveStatus>;

export function parseLiveFrame(raw: unknown): LiveStatusMap {
  const live = new Map<string, SessionLiveStatus>();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return live;
  const frame = raw as Record<string, unknown>;
  const running = frame.runningSessionIds ?? frame.sessionIds;
  if (Array.isArray(running)) {
    for (const id of running) if (typeof id === "string") live.set(id, "running");
  }
  if (frame.sessionStatuses && typeof frame.sessionStatuses === "object" && !Array.isArray(frame.sessionStatuses)) {
    for (const [id, status] of Object.entries(frame.sessionStatuses)) {
      if (typeof status === "string" && (SESSION_LIVE_STATUSES as readonly string[]).includes(status)) {
        live.set(id, status as SessionLiveStatus);
      }
    }
  }
  return live;
}

interface LiveEntry {
  readonly status: SessionLiveStatus;
  readonly since: number | null;
}

type ActivityFeed = "none" | "snapshot" | "stream";

interface ActivityLedgerState {
  readonly feed: ActivityFeed;
  readonly selected: string | null;
  readonly live: ReadonlyMap<string, LiveEntry>;
  readonly unread: ReadonlySet<string>;
  readonly delegateIds: ReadonlySet<string>;
}

export type ActivityEvent =
  | {
      readonly type: "frame";
      readonly source: "snapshot" | "stream";
      readonly live: LiveStatusMap;
      readonly at: number;
    }
  | { readonly type: "selected"; readonly sessionId: string | null }
  | { readonly type: "deleted"; readonly sessionId: string }
  | { readonly type: "listed"; readonly sessions: readonly Pick<SessionInfo, "id" | "relation">[] }
  | { readonly type: "upserted"; readonly session: Pick<SessionInfo, "id" | "relation"> }
  | { readonly type: "host_restarted" };

export const UNREAD_WHEN_LEAVING: Readonly<Record<SessionLiveStatus, boolean>> = {
  running: true,
  error: false,
  awaiting_input: false,
};

export function initialActivityState(unread: ReadonlySet<string>): ActivityLedgerState {
  return { feed: "none", selected: null, live: new Map(), unread: new Set(unread), delegateIds: new Set() };
}

export function activityReducer(state: ActivityLedgerState, event: ActivityEvent): ActivityLedgerState {
  switch (event.type) {
    case "frame": {
      if (event.source === "snapshot" && state.feed === "stream") return state;
      const live = new Map<string, LiveEntry>();
      const unread = new Set(state.unread);
      for (const [id, status] of event.live) {
        const before = state.live.get(id);
        const since =
          before?.status === status ? before.since : status === "running" && state.feed !== "none" ? event.at : null;
        live.set(id, { status, since });
        unread.delete(id);
      }
      for (const [id, before] of state.live) {
        if (
          !live.has(id) &&
          UNREAD_WHEN_LEAVING[before.status] &&
          id !== state.selected &&
          !state.delegateIds.has(id)
        ) {
          unread.add(id);
        }
      }
      return { ...state, feed: event.source, live, unread };
    }
    case "selected": {
      const unread = new Set(state.unread);
      if (event.sessionId !== null) unread.delete(event.sessionId);
      return { ...state, selected: event.sessionId, unread };
    }
    case "deleted": {
      const live = new Map(state.live);
      const unread = new Set(state.unread);
      const delegateIds = new Set(state.delegateIds);
      live.delete(event.sessionId);
      unread.delete(event.sessionId);
      delegateIds.delete(event.sessionId);
      return { ...state, live, unread, delegateIds };
    }
    case "listed": {
      const sessionIds = new Set(event.sessions.map((session) => session.id));
      const delegateIds = new Set(
        event.sessions.filter((session) => session.relation === "delegate").map((session) => session.id),
      );
      const unread = new Set([...state.unread].filter((id) => sessionIds.has(id) && !delegateIds.has(id)));
      const live = state.feed === "stream" ? state.live : new Map([...state.live].filter(([id]) => sessionIds.has(id)));
      return { ...state, live, unread, delegateIds };
    }
    case "upserted": {
      const delegateIds = new Set(state.delegateIds);
      const unread = new Set(state.unread);
      if (event.session.relation === "delegate") {
        delegateIds.add(event.session.id);
        unread.delete(event.session.id);
      } else delegateIds.delete(event.session.id);
      return { ...state, unread, delegateIds };
    }
    case "host_restarted":
      return state.feed === "stream" ? { ...state, feed: "snapshot" } : state;
  }
}

export function sessionActivityFromLegacySignals(signals: SessionActivitySignals): SessionActivity {
  const live = parseLiveFrame({
    runningSessionIds: [...signals.runningSessionIds],
    sessionStatuses: signals.liveStatuses,
  });
  return sessionActivityOf({
    live: new Map([...live].map(([id, status]) => [id, { status, since: null }])),
    unread: signals.unreadSessionIds,
  });
}

export function sessionActivityOf(state: Pick<ActivityLedgerState, "live" | "unread">): SessionActivity {
  return {
    of(sessionId) {
      return state.live.get(sessionId)?.status ?? (state.unread.has(sessionId) ? "unread" : "idle");
    },
    runAge(sessionId, fallbackModifiedIso) {
      const entry = state.live.get(sessionId);
      if (entry?.status !== "running") return { kind: "not-running" };
      if (entry.since !== null) return { kind: "observed", since: entry.since };
      const fallback = fallbackModifiedIso ? Date.parse(fallbackModifiedIso) : NaN;
      return { kind: "unknown", fallbackModifiedMs: Number.isFinite(fallback) ? fallback : null };
    },
  };
}
