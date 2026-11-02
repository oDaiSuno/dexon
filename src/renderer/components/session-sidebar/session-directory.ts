import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { SessionInfo } from "@/lib/types";
import type { SessionLiveStatus } from "@shared/session-orchestration";
import { useI18n } from "@/i18n";
import {
  loadUnreadSessionIds as loadStoredUnreadSessionIds,
  saveUnreadSessionIds as saveStoredUnreadSessionIds,
} from "@/lib/unread-session-storage";
import { applySessionChangedEvent } from "@/lib/session-sidebar-state";
import { activityReducer, initialActivityState, parseLiveFrame, sessionActivityOf } from "@/lib/session-activity-state";
import {
  clearSessionActivity,
  clearSessionCatalog,
  publishSessionActivity,
  publishSessionCatalog,
} from "@/lib/session-catalog";

function loadUnreadSessionIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    return loadStoredUnreadSessionIds(window.localStorage);
  } catch {
    return new Set();
  }
}

function saveUnreadSessionIds(ids: ReadonlySet<string>): void {
  if (typeof window === "undefined") return;
  try {
    saveStoredUnreadSessionIds(window.localStorage, ids);
  } catch {}
}

export function useSessionDirectory({
  selectedSessionId,
  refreshKey,
  onSessionDeleted,
}: {
  selectedSessionId: string | null;
  refreshKey?: number;
  onSessionDeleted?: (sessionId: string) => void;
}) {
  const { t } = useI18n();
  const [allSessions, setAllSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionRefreshDone, setSessionRefreshDone] = useState(false);
  const [ledger, dispatch] = useReducer(activityReducer, undefined, () => initialActivityState(loadUnreadSessionIds()));
  if (ledger.selected !== selectedSessionId) dispatch({ type: "selected", sessionId: selectedSessionId });
  const { live, unread } = ledger;
  const runningSessionIds = useMemo(
    () => new Set([...live].filter(([, entry]) => entry.status === "running").map(([id]) => id)),
    [live],
  );
  const liveStatuses = useMemo<Record<string, SessionLiveStatus>>(
    () => Object.fromEntries([...live].map(([id, entry]) => [id, entry.status])),
    [live],
  );
  const unreadSessionIds = useMemo(() => new Set(unread), [unread]);
  const activity = useMemo(() => sessionActivityOf({ live, unread }), [live, unread]);
  const sessionRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sidebarMountedRef = useRef(false);

  useEffect(() => {
    sidebarMountedRef.current = true;
    return () => {
      sidebarMountedRef.current = false;
      if (sessionRefreshTimerRef.current) clearTimeout(sessionRefreshTimerRef.current);
    };
  }, []);

  const loadSessions = useCallback(
    async (showLoading = false) => {
      try {
        if (showLoading) setLoading(true);
        const res = await fetch("/api/sessions");
        if (!res.ok) {
          const errBody = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(
            res.status === 401
              ? t(
                  "sessionLoadUnauthorized",
                  "Unauthorized (401). Restart Pi Desktop so the renderer can reconnect to the Agent Host.",
                )
              : errBody.error ||
                  t("sessionLoadFailedStatus", "Failed to load sessions ({status})").replace(
                    "{status}",
                    String(res.status),
                  ),
          );
        }
        const data = (await res.json()) as { sessions?: SessionInfo[] };
        const sessions = Array.isArray(data.sessions) ? data.sessions : [];
        setAllSessions(sessions);
        dispatch({ type: "frame", source: "snapshot", live: parseLiveFrame(data), at: Date.now() });
        dispatch({ type: "listed", sessionIds: new Set(sessions.map((session) => session.id)) });
        setError(null);
        if (!showLoading) {
          if (!sidebarMountedRef.current) return;
          setSessionRefreshDone(true);
          if (sessionRefreshTimerRef.current) clearTimeout(sessionRefreshTimerRef.current);
          sessionRefreshTimerRef.current = setTimeout(() => {
            sessionRefreshTimerRef.current = null;
            setSessionRefreshDone(false);
          }, 2000);
        }
      } catch (e) {
        setError(String(e));
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [t],
  );

  const initialLoadDone = useRef(false);
  useEffect(() => {
    const isFirst = !initialLoadDone.current;
    initialLoadDone.current = true;
    void loadSessions(isFirst);
  }, [loadSessions, refreshKey]);

  useEffect(() => {
    publishSessionCatalog(allSessions);
  }, [allSessions]);

  useEffect(() => clearSessionCatalog, []);

  useEffect(() => {
    publishSessionActivity({ liveStatuses, runningSessionIds, unreadSessionIds });
  }, [liveStatuses, runningSessionIds, unreadSessionIds]);

  useEffect(() => clearSessionActivity, []);

  useEffect(() => {
    saveUnreadSessionIds(unreadSessionIds);
  }, [unreadSessionIds]);

  useEffect(() => {
    let source: EventSource | null = null;
    const connectRunningStream = () => {
      source = new EventSource("/api/agent/running/events");
      source.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data) as { type?: string } | null;
          if (data?.type === "running") {
            dispatch({ type: "frame", source: "stream", live: parseLiveFrame(data), at: Date.now() });
          }
        } catch {}
      };
    };
    connectRunningStream();

    const offRestart = window.piBridge?.onHostRestarted?.(() => {
      dispatch({ type: "host_restarted" });
      source?.close();
      connectRunningStream();
      void loadSessions(false);
    });

    return () => {
      offRestart?.();
      source?.close();
    };
  }, [loadSessions]);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    let cancelled = false;
    void import("@/lib/api-client").then(({ subscribeSessionsChanged }) => {
      if (cancelled) return;
      return subscribeSessionsChanged((event) => {
        if (event.fullRefresh || (!event.session && !(event.deleted && event.sessionId))) {
          void loadSessions(false);
        } else {
          setAllSessions((current) => applySessionChangedEvent(current, event) ?? current);
        }
        if (event.deleted && event.sessionId) {
          dispatch({ type: "deleted", sessionId: event.sessionId });
          onSessionDeleted?.(event.sessionId);
        }
      }).then((u) => {
        if (cancelled) u();
        else unsub = u;
      });
    });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [loadSessions, onSessionDeleted]);

  return {
    sessions: allSessions,
    loading,
    error,
    activity,
    runningSessionIds,
    liveStatuses,
    unreadSessionIds,
    sessionRefreshDone,
    refreshSessions: loadSessions,
  };
}
