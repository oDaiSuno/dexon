import { PRIMARY_ENVIRONMENT_ID, type EnvironmentId } from "@contract/environment";
import type { SessionLiveStatus } from "@shared/session-orchestration";
import type { SessionInfo } from "@/lib/types";
import { getEnvironmentApiClient } from "@/lib/api-client";
import { registerEnvironmentSessions } from "@/lib/environment-registry";
import {
  clearSessionActivity,
  clearSessionCatalog,
  publishSessionActivity,
  publishSessionCatalog,
} from "@/lib/session-catalog";
import { activityReducer, initialActivityState, parseLiveFrame, sessionActivityOf } from "@/lib/session-activity-state";
import type { SessionActivity } from "@/lib/session-tree-status";
import { applySessionChangedEvent } from "@/lib/session-sidebar-state";
import { loadUnreadSessionIds, saveUnreadSessionIds } from "@/lib/unread-session-storage";
import { workspaceStore } from "@/lib/workspace-store";

export interface EnvironmentDirectoryState {
  sessions: SessionInfo[];
  runningSessionIds: Set<string>;
  liveStatuses: Record<string, SessionLiveStatus>;
  unreadSessionIds: Set<string>;
  activity: SessionActivity;
  loading: boolean;
  error: string | null;
  sessionRefreshDone: boolean;
}

export function createEnvironmentDirectory(
  environmentId: EnvironmentId,
  publish: (state: EnvironmentDirectoryState) => void,
  onDeleted: (id: string) => void,
) {
  const api = getEnvironmentApiClient(environmentId);
  let unread = new Set<string>();
  try {
    unread = loadUnreadSessionIds(window.localStorage, environmentId);
  } catch {}
  let ledger = initialActivityState(unread);
  let sessions: SessionInfo[] = [];
  let loading = true;
  let error: string | null = null;
  let sessionRefreshDone = false;
  let feedbackTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let revision = 0;
  let subscriptionVersion = 0;
  let pending: Promise<void> | null = null;
  const unsubscribers = new Set<() => void>();
  const emit = () => {
    if (disposed) return;
    const runningSessionIds = new Set(
      [...ledger.live].filter(([, value]) => value.status === "running").map(([id]) => id),
    );
    const liveStatuses = Object.fromEntries([...ledger.live].map(([id, value]) => [id, value.status]));
    const unreadSessionIds = new Set(ledger.unread);
    registerEnvironmentSessions(environmentId, sessions);
    publishSessionCatalog(sessions, environmentId);
    publishSessionActivity({ runningSessionIds, liveStatuses, unreadSessionIds }, environmentId);
    try {
      saveUnreadSessionIds(window.localStorage, unreadSessionIds, environmentId);
    } catch {}
    publish({
      sessions,
      runningSessionIds,
      liveStatuses,
      unreadSessionIds,
      activity: sessionActivityOf(ledger),
      loading,
      error,
      sessionRefreshDone,
    });
  };
  const refresh = (showLoading = false): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (pending) return pending;
    const started = revision;
    if (showLoading) {
      loading = true;
      emit();
    }
    pending = api
      .listSessions()
      .then(async (data) => {
        if (disposed || started !== revision) return;
        sessions = data.sessions.map((session) =>
          environmentId === PRIMARY_ENVIRONMENT_ID ? session : { ...session, environmentId },
        );
        ledger = activityReducer(ledger, {
          type: "frame",
          source: "snapshot",
          live: parseLiveFrame(data),
          at: Date.now(),
        });
        ledger = activityReducer(ledger, {
          type: "listed",
          sessionIds: new Set(sessions.map((session) => session.id)),
        });
        error = null;
        if (environmentId !== PRIMARY_ENVIRONMENT_ID) {
          if (window.piBridge) await workspaceStore.initialize(window.piBridge);
          if (!disposed && started === revision)
            workspaceStore.seedFromSessions(
              environmentId,
              sessions.map((session) => session.projectRoot ?? session.cwd),
            );
        }
        if (disposed || showLoading) return;
        sessionRefreshDone = true;
        if (feedbackTimer) clearTimeout(feedbackTimer);
        feedbackTimer = setTimeout(() => {
          feedbackTimer = null;
          sessionRefreshDone = false;
          emit();
        }, 2000);
      })
      .catch((cause: unknown) => {
        if (disposed) return;
        const code = cause && typeof cause === "object" && "code" in cause ? cause.code : null;
        error = code === "UNAUTHORIZED" ? "UNAUTHORIZED" : cause instanceof Error ? cause.message : String(cause);
      })
      .finally(() => {
        pending = null;
        loading = false;
        emit();
        if (!disposed && started !== revision) void refresh();
      });
    return pending;
  };
  const gap = () => {
    if (disposed) return;
    revision += 1;
    ledger = activityReducer(ledger, { type: "host_restarted" });
    void refresh();
  };
  const attach = () => {
    const version = ++subscriptionVersion;
    const own = (subscription: Promise<() => void>) => {
      void subscription
        .then((off) => {
          if (disposed || version !== subscriptionVersion) off();
          else unsubscribers.add(off);
        })
        .catch(() => {});
    };
    own(
      api.subscribeSessionsChanged((event) => {
        if (disposed || version !== subscriptionVersion) return;
        revision += 1;
        if (event.fullRefresh || (!event.session && !(event.deleted && event.sessionId))) void refresh();
        else {
          const changed =
            event.session && environmentId !== PRIMARY_ENVIRONMENT_ID
              ? { ...event, session: { ...event.session, environmentId } }
              : event;
          sessions = applySessionChangedEvent(sessions, changed) ?? sessions;
        }
        if (event.deleted && event.sessionId) {
          ledger = activityReducer(ledger, { type: "deleted", sessionId: event.sessionId });
          onDeleted(event.sessionId);
        }
        emit();
      }, gap),
    );
    own(
      api.subscribeRunning((event) => {
        if (disposed || version !== subscriptionVersion) return;
        ledger = activityReducer(ledger, {
          type: "frame",
          source: "stream",
          live: parseLiveFrame(event),
          at: Date.now(),
        });
        emit();
      }, gap),
    );
  };
  attach();
  void refresh(true);
  return {
    refresh,
    select(sessionId: string | null) {
      if (ledger.selected === sessionId) return;
      ledger = activityReducer(ledger, { type: "selected", sessionId });
      emit();
    },
    restart() {
      for (const off of unsubscribers) off();
      unsubscribers.clear();
      attach();
      gap();
    },
    dispose() {
      disposed = true;
      subscriptionVersion += 1;
      if (feedbackTimer) clearTimeout(feedbackTimer);
      for (const off of unsubscribers) off();
      clearSessionCatalog(environmentId);
      clearSessionActivity(environmentId);
      registerEnvironmentSessions(environmentId, []);
    },
  };
}
