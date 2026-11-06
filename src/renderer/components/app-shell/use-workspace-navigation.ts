import { workspaceStore, type WorkspaceFocus } from "@/lib/workspace-store";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { getEnvironmentApiClient } from "@/lib/api-client";
import { PRIMARY_ENVIRONMENT_ID, parseQualifiedProjectKey } from "@contract/environment";
import {
  getActiveEnvironmentId,
  getSessionEnvironmentId,
  registerEnvironmentSession,
} from "@/lib/environment-registry";
import { beginSessionLoadTrace } from "@/lib/session-performance";
import { readSessionIdFromSearch, routerCompat } from "@/lib/router-compat";
import { getSessionCatalog, subscribeSessionCatalog } from "@/lib/session-catalog";
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
  const catalog = useSyncExternalStore(subscribeSessionCatalog, getSessionCatalog, getSessionCatalog);
  const { focus } = useSyncExternalStore(
    workspaceStore.subscribe,
    workspaceStore.getSnapshot,
    workspaceStore.getSnapshot,
  );
  const [openedSession, setOpenedSession] = useState<SessionInfo | null>(null);
  const selectedSession = useMemo(
    () =>
      openedSession &&
      (openedSession.environmentId ?? PRIMARY_ENVIRONMENT_ID) === focus.environmentId &&
      focus.sessionId === openedSession.id
        ? ((openedSession &&
            catalog.find(
              (session) =>
                session.id === openedSession.id &&
                (session.environmentId ?? PRIMARY_ENVIRONMENT_ID) ===
                  (openedSession.environmentId ?? PRIMARY_ENVIRONMENT_ID),
            )) ??
          openedSession)
        : null,
    [catalog, openedSession, focus.environmentId, focus.sessionId],
  );

  const [newSession, setNewSession] = useState<{ scope: string; cwd: string } | null>(null);
  const scope = JSON.stringify([focus.environmentId, focus.spaceKey]);
  const newSessionCwd = newSession?.scope === scope ? newSession.cwd : null;
  const setNewSessionCwd = useCallback((value: string | null | ((current: string | null) => string | null)) => {
    const focus = workspaceStore.getSnapshot().focus;
    const scope = JSON.stringify([focus.environmentId, focus.spaceKey]);
    setNewSession((current) => {
      const cwd = typeof value === "function" ? value(current?.scope === scope ? current.cwd : null) : value;
      return cwd === null ? null : { scope, cwd };
    });
  }, []);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sessionKey, setSessionKey] = useState(0);
  const [activeCwd, setActiveCwd] = useState<string | null>(null);
  const [initialSessionId] = useState<string | null>(() => readSessionIdFromSearch(window.location.search));

  const [initialSessionRestored, setInitialSessionRestored] = useState<boolean>(() => !initialSessionId);

  const suppressCwdBumpRef = useRef(false);
  const [spaceFrozenSessionId, setSpaceFrozenSessionId] = useState<string | null>(null);
  const [pendingOpen, setPendingOpen] = useState<{ id: string; focus: WorkspaceFocus } | null>(null);
  const openRequest = useRef(0);

  const openSessionById = useCallback(
    (sessionId: string) => {
      const initial = workspaceStore.getSnapshot();
      let origin = initial.focus;
      const request = ++openRequest.current;
      void (async () => {
        try {
          if (!initial.loaded && window.piBridge) await workspaceStore.initialize(window.piBridge);
          if (request !== openRequest.current) return;
          origin = workspaceStore.getSnapshot().focus;
          const guessedEnvironmentId = getSessionEnvironmentId(sessionId);
          const listed =
            getSessionCatalog(guessedEnvironmentId).find((session) => session.id === sessionId) ??
            getSessionCatalog().find((session) => session.id === sessionId);
          const environmentId = listed ? (listed.environmentId ?? PRIMARY_ENVIRONMENT_ID) : guessedEnvironmentId;
          const found =
            listed ??
            (await getEnvironmentApiClient(environmentId).listSessions()).sessions.find(
              (session) => session.id === sessionId,
            );
          if (request !== openRequest.current || workspaceStore.getSnapshot().focus !== origin) return;
          if (!found) {
            setPendingOpen({ id: sessionId, focus: origin });
            return;
          }
          setPendingOpen(null);
          workspaceStore.focusSession({ ...found, environmentId });
          const scoped = environmentId === PRIMARY_ENVIRONMENT_ID ? found : { ...found, environmentId };
          onShowChat?.();
          setNewSessionCwd(null);
          setOpenedSession(scoped);
          setSessionKey((k) => k + 1);
          setRefreshKey((k) => k + 1);
          router.replace(`?session=${encodeURIComponent(sessionId)}`);
        } catch (error) {
          if (request === openRequest.current && workspaceStore.getSnapshot().focus === origin)
            setPendingOpen({ id: sessionId, focus: origin });
          console.error("open session failed", error);
        }
      })();
    },
    [onShowChat, router, setNewSessionCwd],
  );

  useEffect(() => {
    if (!pendingOpen) return;
    if (focus !== pendingOpen.focus) {
      setPendingOpen(null);
      return;
    }
    if (!catalog.some((session) => session.id === pendingOpen.id)) return;
    setPendingOpen(null);
    openSessionById(pendingOpen.id);
  }, [pendingOpen, catalog, focus, openSessionById]);

  useEffect(() => subscribeOpenSessionRequests(openSessionById), [openSessionById]);

  useEffect(() => {
    const offDeep = window.piBridge?.onDeepLinkSession?.((sessionId) => openSessionById(sessionId));
    const offNew = window.piBridge?.onMenu?.("new-session", () => {
      if (!activeCwd) return;
      openRequest.current += 1;
      setPendingOpen(null);
      const currentFocus = workspaceStore.getSnapshot().focus;
      const root = currentFocus.spaceKey ? parseQualifiedProjectKey(currentFocus.spaceKey)?.path : null;
      workspaceStore.openSpace({ environmentId: getActiveEnvironmentId(), path: root ?? activeCwd });
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
  }, [activeCwd, router, onSwitchSessionRequested, onShowChat, openSessionById, setNewSessionCwd]);

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

      if (selectedSession)
        workspaceStore.openSpace({
          environmentId: selectedSession.environmentId ?? PRIMARY_ENVIRONMENT_ID,
          path: newProject,
        });
      setOpenedSession(null);
      setNewSessionCwd((prev) => {
        if (prev && prev !== cwd) return null;
        return prev;
      });
      setSessionKey((k) => k + 1);
      onTopPanelDismiss();
      router.replace("/", { scroll: false });
    },
    [router, selectedSession, onTopPanelDismiss, setNewSessionCwd],
  );

  const handleSelectSession = useCallback(
    (session: SessionInfo, isRestore = false, keepSpace = false) => {
      if (!isRestore) {
        openRequest.current += 1;
        setPendingOpen(null);
      }
      const environmentId = session.environmentId ?? PRIMARY_ENVIRONMENT_ID;
      const currentFocus = workspaceStore.getSnapshot().focus;
      const keptSpace =
        keepSpace && currentFocus.environmentId === environmentId
          ? ((currentFocus.spaceKey ? parseQualifiedProjectKey(currentFocus.spaceKey)?.path : null) ?? activeCwd)
          : null;
      workspaceStore.focusSession({ ...session, environmentId, projectRoot: keptSpace ?? session.projectRoot });
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
    [router, isMobile, onMobileSidebarClose, onShowChat, selectedSession, activeCwd, setNewSessionCwd],
  );

  const handleNewSession = useCallback(
    (_sessionId: string, cwd: string) => {
      openRequest.current += 1;
      setPendingOpen(null);
      const currentFocus = workspaceStore.getSnapshot().focus;
      const root = currentFocus.spaceKey ? parseQualifiedProjectKey(currentFocus.spaceKey)?.path : null;
      workspaceStore.openSpace({ environmentId: getActiveEnvironmentId(), path: root ?? cwd });
      setActiveCwd(cwd);
      onShowChat?.();
      setOpenedSession(null);
      setNewSessionCwd(cwd);
      setSessionKey((k) => k + 1);
      onTopPanelDismiss();
      if (isMobile) onMobileSidebarClose();
      router.replace("/", { scroll: false });
    },
    [router, isMobile, onTopPanelDismiss, onMobileSidebarClose, onShowChat, setNewSessionCwd],
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
      const environmentId = session.environmentId ?? getActiveEnvironmentId();
      registerEnvironmentSession(environmentId, session.id);
      workspaceStore.focusSession({ ...session, environmentId });
      setNewSessionCwd(null);
      setOpenedSession(environmentId === PRIMARY_ENVIRONMENT_ID ? session : { ...session, environmentId });
      setRefreshKey((k) => k + 1);
      hydrateSelectedSession(session.id);
      router.replace(`?session=${encodeURIComponent(session.id)}`, { scroll: false });
    },
    [router, hydrateSelectedSession, setNewSessionCwd],
  );

  const handleSessionForked = useCallback(
    (newSessionId: string) => {
      const environmentId = getActiveEnvironmentId();
      registerEnvironmentSession(environmentId, newSessionId);
      workspaceStore.focusSession({
        id: newSessionId,
        environmentId,
        cwd: selectedSession?.cwd,
        projectRoot: selectedSession?.projectRoot,
      });
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
    [router, hydrateSelectedSession, selectedSession, setNewSessionCwd],
  );

  const handleSessionDeleted = useCallback(
    (sessionId: string) => {
      onBeforeSessionDeleted?.(sessionId);
      setRefreshKey((k) => k + 1);
      if (selectedSession?.id === sessionId) {
        const cwd = selectedSession.cwd;
        if (cwd)
          workspaceStore.openSpace({
            environmentId: selectedSession.environmentId ?? PRIMARY_ENVIRONMENT_ID,
            path: selectedSession.projectRoot ?? cwd,
          });
        setOpenedSession(null);
        setNewSessionCwd(cwd ?? null);
        setSessionKey((k) => k + 1);
        onTopPanelDismiss();
        router.replace("/", { scroll: false });
      }
    },
    [onBeforeSessionDeleted, selectedSession, router, onTopPanelDismiss, setNewSessionCwd],
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
    environmentId: focus.environmentId,
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
