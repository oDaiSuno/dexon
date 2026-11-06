import { workspaceStore } from "@/lib/workspace-store";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getEnvironmentApiClient } from "@/lib/api-client";
import { PRIMARY_ENVIRONMENT_ID } from "@contract/environment";
import {
  getActiveEnvironmentId,
  getSessionEnvironmentId,
  registerEnvironmentSession,
} from "@/lib/environment-registry";
import { beginSessionLoadTrace } from "@/lib/session-performance";
import { readSessionIdFromSearch, routerCompat } from "@/lib/router-compat";
import { getSessionCatalog, useSessionCatalog } from "@/lib/session-catalog";
import { subscribeOpenSessionRequests } from "@/lib/session-open-request";
import { requestSessionSearchFocus } from "@/lib/session-search-focus";
import { worktreePathsEqual } from "@shared/worktree-path";
import type { SessionInfo } from "@/lib/types";

export function useWorkspaceNavigation({
  isMobile,
  onMobileSidebarClose,
  onTopPanelDismiss,
  onSwitchSessionRequested,
  onBeforeSessionDeleted,
  onShowChat,
}: {
  isMobile: boolean;
  onMobileSidebarClose: () => void;
  onTopPanelDismiss: () => void;
  onSwitchSessionRequested: () => void;
  onBeforeSessionDeleted?: (sessionId: string) => void;
  onShowChat?: () => void;
}) {
  const router = routerCompat;
  const catalog = useSessionCatalog();
  const [openedSession, setOpenedSession] = useState<SessionInfo | null>(null);
  const selectedSession = useMemo(
    () =>
      (openedSession &&
        catalog.find(
          (session) =>
            session.id === openedSession.id &&
            (session.environmentId ?? PRIMARY_ENVIRONMENT_ID) ===
              (openedSession.environmentId ?? PRIMARY_ENVIRONMENT_ID),
        )) ??
      openedSession,
    [catalog, openedSession],
  );

  const [newSessionCwd, setNewSessionCwd] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sessionKey, setSessionKey] = useState(0);
  const [activeCwd, setActiveCwd] = useState<string | null>(null);
  const [initialSessionId] = useState<string | null>(() => readSessionIdFromSearch(window.location.search));

  const [initialSessionRestored, setInitialSessionRestored] = useState<boolean>(() => !initialSessionId);

  const suppressCwdBumpRef = useRef(false);
  const [spaceFrozenSessionId, setSpaceFrozenSessionId] = useState<string | null>(null);

  const openSessionById = useCallback(
    (sessionId: string) => {
      void (async () => {
        try {
          const environmentId = getSessionEnvironmentId(sessionId);
          const listed = getSessionCatalog(environmentId).find((session) => session.id === sessionId);
          const found =
            listed ??
            (await getEnvironmentApiClient(environmentId).listSessions()).sessions.find(
              (session) => session.id === sessionId,
            );
          if (!found) return;
          workspaceStore.focusSession({ ...found, environmentId });
          const scoped = environmentId === PRIMARY_ENVIRONMENT_ID ? found : { ...found, environmentId };
          onShowChat?.();
          setNewSessionCwd(null);
          setOpenedSession(scoped);
          setSessionKey((k) => k + 1);
          setRefreshKey((k) => k + 1);
          router.replace(`?session=${encodeURIComponent(sessionId)}`);
        } catch (error) {
          console.error("open session failed", error);
        }
      })();
    },
    [onShowChat, router],
  );

  useEffect(() => subscribeOpenSessionRequests(openSessionById), [openSessionById]);

  useEffect(() => {
    const offDeep = window.piBridge?.onDeepLinkSession?.((sessionId) => openSessionById(sessionId));
    const offNew = window.piBridge?.onMenu?.("new-session", () => {
      if (!activeCwd) return;
      onShowChat?.();
      setOpenedSession(null);
      setNewSessionCwd(activeCwd);
      setSessionKey((k) => k + 1);
      router.replace("/", { scroll: false });
    });

    const offSwitch = window.piBridge?.onMenu?.("switch-session", () => {
      onSwitchSessionRequested();
      setRefreshKey((k) => k + 1);
      requestSessionSearchFocus();
    });
    return () => {
      offDeep?.();
      offNew?.();
      offSwitch?.();
    };
  }, [activeCwd, router, onSwitchSessionRequested, onShowChat, openSessionById]);

  const handleCwdChange = useCallback(
    (cwd: string | null, projectRoot?: string | null) => {
      setActiveCwd(cwd);

      if (!cwd) return;
      if (suppressCwdBumpRef.current) {
        suppressCwdBumpRef.current = false;
        return;
      }

      const newProject = projectRoot ?? cwd;
      if (selectedSession && worktreePathsEqual(selectedSession.projectRoot ?? selectedSession.cwd, newProject)) {
        return;
      }

      setOpenedSession(null);
      setNewSessionCwd((prev) => {
        if (prev && prev !== cwd) return null;
        return prev;
      });
      setSessionKey((k) => k + 1);
      onTopPanelDismiss();
      router.replace("/", { scroll: false });
    },
    [router, selectedSession, onTopPanelDismiss],
  );

  const handleSelectSession = useCallback(
    (session: SessionInfo, isRestore = false, keepSpace = false) => {
      const environmentId = session.environmentId ?? PRIMARY_ENVIRONMENT_ID;
      workspaceStore.focusSession({ ...session, environmentId });
      setSpaceFrozenSessionId(keepSpace ? session.id : null);
      if (!isRestore) onShowChat?.();
      if (
        !isRestore &&
        selectedSession?.id === session.id &&
        (selectedSession.environmentId ?? PRIMARY_ENVIRONMENT_ID) === environmentId
      ) {
        if (isMobile) onMobileSidebarClose();
        return;
      }
      beginSessionLoadTrace(session.id, isRestore ? "restore" : "selection");
      setNewSessionCwd(null);
      setOpenedSession(session);
      setSessionKey((k) => k + 1);
      setInitialSessionRestored(true);

      if (isMobile && !isRestore) onMobileSidebarClose();
      if (isRestore) {
        suppressCwdBumpRef.current = true;
      }

      if (!isRestore) {
        router.replace(`?session=${encodeURIComponent(session.id)}`, { scroll: false });
      }
    },
    [router, isMobile, onMobileSidebarClose, onShowChat, selectedSession],
  );

  const handleNewSession = useCallback(
    (_sessionId: string, cwd: string) => {
      onShowChat?.();
      setOpenedSession(null);
      setNewSessionCwd(cwd);
      setSessionKey((k) => k + 1);
      onTopPanelDismiss();
      if (isMobile) onMobileSidebarClose();
      router.replace("/", { scroll: false });
    },
    [router, isMobile, onTopPanelDismiss, onMobileSidebarClose, onShowChat],
  );

  const hydrateSelectedSession = useCallback((sessionId: string) => {
    const environmentId = getSessionEnvironmentId(sessionId);
    void getEnvironmentApiClient(environmentId)
      .listSessions()
      .then((d) => {
        const full = d.sessions.find((s) => s.id === sessionId);
        if (!full) return;
        setOpenedSession((prev) =>
          prev &&
          prev.id === sessionId &&
          (prev.environmentId ?? PRIMARY_ENVIRONMENT_ID) === environmentId &&
          !prev.projectRoot
            ? environmentId === PRIMARY_ENVIRONMENT_ID
              ? full
              : { ...full, environmentId }
            : prev,
        );
      })
      .catch(() => {});
  }, []);

  const handleSessionCreated = useCallback(
    (session: SessionInfo) => {
      const environmentId = getActiveEnvironmentId();
      registerEnvironmentSession(environmentId, session.id);
      setNewSessionCwd(null);
      setOpenedSession(environmentId === PRIMARY_ENVIRONMENT_ID ? session : { ...session, environmentId });
      setRefreshKey((k) => k + 1);
      hydrateSelectedSession(session.id);
      router.replace(`?session=${encodeURIComponent(session.id)}`, { scroll: false });
    },
    [router, hydrateSelectedSession],
  );

  const handleSessionForked = useCallback(
    (newSessionId: string) => {
      registerEnvironmentSession(getActiveEnvironmentId(), newSessionId);
      setRefreshKey((k) => k + 1);
      setSessionKey((k) => k + 1);
      setNewSessionCwd(null);
      setOpenedSession((prev) => ({
        ...(prev ?? { path: "", cwd: "", created: "", modified: "", messageCount: 0, firstMessage: "" }),
        id: newSessionId,
      }));
      hydrateSelectedSession(newSessionId);
      router.replace(`?session=${encodeURIComponent(newSessionId)}`, { scroll: false });
    },
    [router, hydrateSelectedSession],
  );

  const handleSessionDeleted = useCallback(
    (sessionId: string) => {
      onBeforeSessionDeleted?.(sessionId);
      setRefreshKey((k) => k + 1);
      if (selectedSession?.id === sessionId) {
        const cwd = selectedSession.cwd;
        setOpenedSession(null);
        setNewSessionCwd(cwd ?? null);
        setSessionKey((k) => k + 1);
        onTopPanelDismiss();
        router.replace("/", { scroll: false });
      }
    },
    [onBeforeSessionDeleted, selectedSession, router, onTopPanelDismiss],
  );

  const handleInitialRestoreDone = useCallback(() => {
    setInitialSessionRestored(true);
  }, []);

  const noteCoordinatorCwd = useCallback((cwd: string | null) => {
    if (!cwd) return;
    setActiveCwd(cwd);
  }, []);

  const bumpSessionKey = useCallback(() => {
    setSessionKey((k) => k + 1);
  }, []);

  const bumpRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  return {
    selectedSession,
    spaceFrozenSessionId,
    newSessionCwd,
    activeCwd,
    sessionKey,
    refreshKey,
    initialSessionId,
    initialSessionRestored,
    handleCwdChange,
    handleSelectSession,
    handleNewSession,
    handleSessionCreated,
    handleSessionForked,
    handleSessionDeleted,
    handleInitialRestoreDone,
    bumpSessionKey,
    bumpRefresh,
    noteCoordinatorCwd,
  };
}
