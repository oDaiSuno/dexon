import { useEffect, useRef, useState } from "react";
import { PRIMARY_ENVIRONMENT_ID, type EnvironmentId, type EnvironmentView } from "@contract/environment";
import type { SessionLiveStatus } from "@shared/session-orchestration";
import type { SessionInfo } from "@/lib/types";
import { createEnvironmentApiClient } from "@/lib/environment-connection";
import {
  getEnvironmentConnection,
  registerEnvironmentSessions,
  useActiveEnvironment,
  useEnvironments,
} from "@/lib/environment-registry";
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

interface DirectoryState {
  sessions: SessionInfo[];
  runningSessionIds: Set<string>;
  liveStatuses: Record<string, SessionLiveStatus>;
  unreadSessionIds: Set<string>;
  activity: SessionActivity;
  loading: boolean;
  error: string | null;
}

function createDirectory(environmentId: EnvironmentId, publish: (state: DirectoryState) => void) {
  const api = createEnvironmentApiClient(getEnvironmentConnection(environmentId));
  let unread = new Set<string>();
  try {
    unread = loadUnreadSessionIds(window.localStorage, environmentId);
  } catch {}
  let ledger = initialActivityState(unread);
  let sessions: SessionInfo[] = [];
  let loading = true;
  let error: string | null = null;
  let disposed = false;
  let revision = 0;
  let pending: Promise<void> | null = null;
  const unsubscribers: (() => void)[] = [];
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
    });
  };
  const refresh = (): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (pending) return pending;
    const started = revision;
    pending = api
      .listSessions()
      .then((data) => {
        if (disposed || started !== revision) return;
        sessions = data.sessions.map((session) => ({ ...session, environmentId }));
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
      })
      .catch((cause: unknown) => {
        if (!disposed) error = cause instanceof Error ? cause.message : String(cause);
      })
      .finally(() => {
        pending = null;
        loading = false;
        emit();
        if (!disposed && started !== revision) void refresh();
      });
    return pending;
  };
  const onGap = () => {
    revision += 1;
    ledger = activityReducer(ledger, { type: "host_restarted" });
    void refresh();
  };
  const own = (subscription: Promise<() => void>) => {
    void subscription
      .then((off) => {
        if (disposed) off();
        else unsubscribers.push(off);
      })
      .catch((cause: unknown) => {
        error = cause instanceof Error ? cause.message : String(cause);
        emit();
      });
  };
  own(
    api.subscribeSessionsChanged((event) => {
      if (disposed) return;
      revision += 1;
      if (event.fullRefresh || (!event.session && !(event.deleted && event.sessionId))) {
        void refresh();
        return;
      }
      const changed = event.session ? { ...event, session: { ...event.session, environmentId } } : event;
      sessions = applySessionChangedEvent(sessions, changed) ?? sessions;
      if (event.deleted && event.sessionId)
        ledger = activityReducer(ledger, { type: "deleted", sessionId: event.sessionId });
      emit();
    }, onGap),
  );
  own(
    api.subscribeRunning((event) => {
      if (disposed) return;
      ledger = activityReducer(ledger, {
        type: "frame",
        source: "stream",
        live: parseLiveFrame(event),
        at: Date.now(),
      });
      emit();
    }, onGap),
  );
  void refresh();
  return {
    refresh,
    select(sessionId: string | null) {
      if (ledger.selected === sessionId) return;
      ledger = activityReducer(ledger, { type: "selected", sessionId });
      emit();
    },
    dispose() {
      disposed = true;
      for (const off of unsubscribers) off();
      clearSessionCatalog(environmentId);
      clearSessionActivity(environmentId);
      registerEnvironmentSessions(environmentId, []);
    },
  };
}

type DirectoryController = ReturnType<typeof createDirectory>;

export interface RemoteEnvironmentDirectory extends DirectoryState {
  environment: EnvironmentView;
  refreshSessions: () => Promise<void>;
}

export function useRemoteEnvironmentDirectories(selectedSessionId: string | null): RemoteEnvironmentDirectory[] {
  const environments = useEnvironments();
  const activeEnvironment = useActiveEnvironment();
  const controllers = useRef(new Map<EnvironmentId, DirectoryController>());
  const [states, setStates] = useState<Record<EnvironmentId, DirectoryState>>({});

  useEffect(() => {
    const ids = new Set(environments.map((view) => view.id));
    for (const [id, directory] of controllers.current) {
      if (!ids.has(id)) {
        directory.dispose();
        controllers.current.delete(id);
        setStates((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)));
      }
    }
    for (const view of environments) {
      if (view.id === PRIMARY_ENVIRONMENT_ID || view.status.phase !== "connected" || controllers.current.has(view.id))
        continue;
      const directory = createDirectory(view.id, (state) => setStates((current) => ({ ...current, [view.id]: state })));
      controllers.current.set(view.id, directory);
      directory.select(activeEnvironment.id === view.id ? selectedSessionId : null);
    }
  }, [environments, activeEnvironment.id, selectedSessionId]);

  useEffect(() => {
    for (const [id, directory] of controllers.current)
      directory.select(activeEnvironment.id === id ? selectedSessionId : null);
  }, [activeEnvironment.id, selectedSessionId]);

  useEffect(() => {
    const current = controllers.current;
    return () => {
      for (const directory of current.values()) directory.dispose();
      current.clear();
    };
  }, []);

  return environments
    .filter((view) => view.id !== PRIMARY_ENVIRONMENT_ID)
    .map((environment) => {
      const state = states[environment.id];
      return {
        environment,
        sessions: state?.sessions ?? [],
        runningSessionIds: state?.runningSessionIds ?? new Set<string>(),
        liveStatuses: state?.liveStatuses ?? {},
        unreadSessionIds: state?.unreadSessionIds ?? new Set<string>(),
        activity: state?.activity ?? sessionActivityOf(initialActivityState(new Set())),
        loading: environment.status.phase === "connected" && (state?.loading ?? true),
        error: state?.error ?? null,
        refreshSessions: () => controllers.current.get(environment.id)?.refresh() ?? Promise.resolve(),
      };
    });
}
