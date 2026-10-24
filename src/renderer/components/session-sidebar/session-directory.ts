import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionInfo } from "@/lib/types";
import type { SessionLiveStatus } from "@shared/session-orchestration";
import { useI18n } from "@/i18n";
import {
  loadUnreadSessionIds as loadStoredUnreadSessionIds,
  saveUnreadSessionIds as saveStoredUnreadSessionIds,
} from "@/lib/unread-session-storage";
import { applySessionChangedEvent } from "@/lib/session-sidebar-state";
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

function saveUnreadSessionIds(ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    saveStoredUnreadSessionIds(window.localStorage, ids);
  } catch {
    // ignore storage quota / privacy-mode errors
  }
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
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(() => new Set());
  const [liveStatuses, setLiveStatuses] = useState<Record<string, SessionLiveStatus>>({});
  const [unreadSessionIds, setUnreadSessionIds] = useState<Set<string>>(() => loadUnreadSessionIds());
  const previousRunningSessionIdsRef = useRef<Set<string>>(new Set());
  // Once the live stream has delivered a frame it is the source of truth for
  // running state; late session responses must not overwrite it.
  const streamAuthoritativeRef = useRef(false);
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
        const data = (await res.json()) as {
          sessions?: SessionInfo[];
          runningSessionIds?: string[];
          sessionStatuses?: Record<string, SessionLiveStatus>;
        };
        const sessions = Array.isArray(data.sessions) ? data.sessions : [];
        setAllSessions(sessions);
        // Treat the fetched running set as an initial fallback only. Once the stream is
        // live it owns this state, so a slow fetch can't revive a stale snapshot.
        if (!streamAuthoritativeRef.current) {
          setRunningSessionIds(new Set(data.runningSessionIds ?? []));
          setLiveStatuses(data.sessionStatuses ?? {});
        }
        // Drop unread markers for sessions that no longer exist (e.g. deleted).
        const existingIds = new Set(sessions.map((s) => s.id));
        setUnreadSessionIds((prev) => {
          if (prev.size === 0) return prev;
          const next = new Set([...prev].filter((id) => existingIds.has(id)));
          return next.size === prev.size ? prev : next;
        });
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

  // Persist unread markers so they survive a browser refresh before the user
  // has actually opened the completed session.
  useEffect(() => {
    saveUnreadSessionIds(unreadSessionIds);
  }, [unreadSessionIds]);

  useEffect(() => {
    // Live running status via IPC stream (shimmed as EventSource).
    // The shim pins the subscription to the current RPC client, so an Agent
    // Host restart kills it silently. Reconnect on restart and drop the
    // authoritative flag so the next fetch can repopulate the running set.
    let source: EventSource | null = null;
    const connectRunningStream = () => {
      source = new EventSource("/api/agent/running/events");
      source.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data) as {
            type?: string;
            runningSessionIds?: string[];
            sessionIds?: string[];
            sessionStatuses?: Record<string, SessionLiveStatus>;
          };
          if (data.type === "running") {
            streamAuthoritativeRef.current = true;
            setRunningSessionIds(new Set(data.runningSessionIds ?? data.sessionIds ?? []));
            setLiveStatuses(data.sessionStatuses ?? {});
          }
        } catch {
          // ignore malformed frames
        }
      };
    };
    connectRunningStream();

    const offRestart = window.piBridge?.onHostRestarted?.(() => {
      streamAuthoritativeRef.current = false;
      source?.close();
      connectRunningStream();
      void loadSessions(false);
    });

    return () => {
      offRestart?.();
      source?.close();
    };
  }, [loadSessions]);

  // sessions.changed (CLI / disk watcher) → refresh sidebar without polling
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
          setUnreadSessionIds((current) => {
            if (!current.has(event.sessionId!)) return current;
            const next = new Set(current);
            next.delete(event.sessionId!);
            return next;
          });
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

  useEffect(() => {
    const previous = previousRunningSessionIdsRef.current;
    const completedInBackground = [...previous].filter((id) => !runningSessionIds.has(id) && id !== selectedSessionId);
    const newlyRunning = [...runningSessionIds];

    if (completedInBackground.length > 0 || newlyRunning.length > 0) {
      setUnreadSessionIds((prev) => {
        const next = new Set(prev);
        newlyRunning.forEach((id) => next.delete(id));
        completedInBackground.forEach((id) => next.add(id));
        return next;
      });
    }

    previousRunningSessionIdsRef.current = runningSessionIds;
  }, [runningSessionIds, selectedSessionId]);

  useEffect(() => {
    if (!selectedSessionId) return;
    setUnreadSessionIds((prev) => {
      if (!prev.has(selectedSessionId)) return prev;
      const next = new Set(prev);
      next.delete(selectedSessionId);
      return next;
    });
  }, [selectedSessionId]);

  return {
    sessions: allSessions,
    loading,
    error,
    runningSessionIds,
    liveStatuses,
    unreadSessionIds,
    sessionRefreshDone,
    refreshSessions: loadSessions,
  };
}
