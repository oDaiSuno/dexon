import { resolveWorkspaceLocation, workspaceStore, type WorkspaceFocus } from "@/lib/workspace-store";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { getEnvironmentApiClient } from "@/lib/api-client";
import { PRIMARY_ENVIRONMENT_ID, parseQualifiedProjectKey, type EnvironmentId } from "@contract/environment";
import {
  subscribeAutomationPageRequest,
  subscribeAutomationAiSessionRequest,
  subscribeSealedAutomationSessionRequest,
  type AutomationRouteTarget,
} from "@/lib/automation-request";
import { clearAutomationSessionIntent, setAutomationSessionIntent } from "@/lib/automation-session-intent";
import { createTemporarySessionId } from "@/lib/temporary-session-id";
import type { NavPage } from "../app-nav/nav-sidebar";
import {
  getActiveEnvironmentId,
  getEnvironmentConnection,
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

export function useWorkspaceNavigation(options: {
  isMobile: boolean;
  onMobileSidebarClose: () => void;
  onTopPanelDismiss: () => void;
  onSwitchSessionRequested: () => void;
  onBeforeSessionDeleted?: (sessionId: string) => void;
  onShowChat?: () => void;
}) {
  const { isMobile, onMobileSidebarClose, onTopPanelDismiss } = options;
  const { onSwitchSessionRequested, onBeforeSessionDeleted, onShowChat } = options;
  const router = routerCompat;
  const catalog = useSyncExternalStore(subscribeSessionCatalog, getSessionCatalog, getSessionCatalog);
  const snapshot = useSyncExternalStore(
    workspaceStore.subscribe,
    workspaceStore.getSnapshot,
    workspaceStore.getSnapshot,
  );
  const { focus } = snapshot;
  useEffect(() => {
    let previous = workspaceStore.getSnapshot().focus;
    return workspaceStore.subscribe(() => {
      const next = workspaceStore.getSnapshot().focus;
      if (
        next.environmentId !== previous.environmentId ||
        next.spaceKey !== previous.spaceKey ||
        next.sessionId !== previous.sessionId
      )
        clearAutomationSessionIntent();
      previous = next;
    });
  }, []);
  const [openedSession, setOpenedSession] = useState<SessionInfo | null>(null);
  const selectedSession = useMemo(
    () =>
      openedSession && openedSession.environmentId === focus.environmentId && focus.sessionId === openedSession.id
        ? (catalog.find(
            (session) => session.id === openedSession.id && session.environmentId === openedSession.environmentId,
          ) ?? openedSession)
        : null,
    [catalog, openedSession, focus.environmentId, focus.sessionId],
  );
  const [newSession, setNewSession] = useState<{ scope: string; cwd: string } | null>(null);
  const scope = JSON.stringify([focus.environmentId, focus.spaceKey]);
  const newSessionCwd = newSession?.scope === scope ? newSession.cwd : null;
  const setNewSessionCwd = useCallback((cwd: string | null) => {
    const focus = workspaceStore.getSnapshot().focus;
    const scope = JSON.stringify([focus.environmentId, focus.spaceKey]);
    setNewSession(cwd === null ? null : { scope, cwd });
  }, []);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sessionKey, setSessionKey] = useState(0);
  const location = resolveWorkspaceLocation(snapshot, selectedSession);
  const [initialSessionId] = useState<string | null>(() => readSessionIdFromSearch(window.location.search));
  const [initialSessionRestored, setInitialSessionRestored] = useState<boolean>(() => !initialSessionId);
  const suppressCwdBumpRef = useRef(false);
  const [spaceFrozenSessionId, setSpaceFrozenSessionId] = useState<string | null>(null);
  const [pendingOpen, setPendingOpen] = useState<{
    id: string;
    focus: WorkspaceFocus;
    environmentId?: EnvironmentId;
  } | null>(null);
  const openRequest = useRef(0);
  const openSessionById = useCallback(
    (sessionId: string, requestedEnvironmentId?: EnvironmentId) => {
      clearAutomationSessionIntent();
      const initial = workspaceStore.getSnapshot();
      let origin = initial.focus;
      const request = ++openRequest.current;
      void (async () => {
        try {
          if (!initial.loaded && window.piBridge) await workspaceStore.initialize(window.piBridge);
          if (request !== openRequest.current) return;
          origin = workspaceStore.getSnapshot().focus;
          const registeredEnvironmentId = requestedEnvironmentId ?? getSessionEnvironmentId(sessionId);
          const listed = registeredEnvironmentId
            ? getSessionCatalog(registeredEnvironmentId).find((session) => session.id === sessionId)
            : getSessionCatalog().find((session) => session.id === sessionId);
          const environmentId =
            requestedEnvironmentId ?? listed?.environmentId ?? registeredEnvironmentId ?? origin.environmentId;
          const found =
            listed ??
            (await getEnvironmentApiClient(environmentId).listSessions()).sessions.find(
              (session) => session.id === sessionId,
            );
          if (request !== openRequest.current || workspaceStore.getSnapshot().focus !== origin) return;
          if (!found) {
            setPendingOpen({ id: sessionId, focus: origin, environmentId: requestedEnvironmentId });
            return;
          }
          setPendingOpen(null);
          workspaceStore.focusSession({ ...found, environmentId });
          const scoped = { ...found, environmentId };
          onShowChat?.();
          setNewSessionCwd(null);
          setOpenedSession(scoped);
          setSessionKey((k) => k + 1);
          setRefreshKey((k) => k + 1);
          router.replace(`?session=${encodeURIComponent(sessionId)}`);
        } catch (error) {
          if (request === openRequest.current && workspaceStore.getSnapshot().focus === origin)
            setPendingOpen({ id: sessionId, focus: origin, environmentId: requestedEnvironmentId });
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
    if (
      !catalog.some(
        (session) =>
          session.id === pendingOpen.id &&
          (!pendingOpen.environmentId || session.environmentId === pendingOpen.environmentId),
      )
    )
      return;
    setPendingOpen(null);
    openSessionById(pendingOpen.id, pendingOpen.environmentId);
  }, [pendingOpen, catalog, focus, openSessionById]);
  useEffect(() => subscribeOpenSessionRequests(openSessionById), [openSessionById]);
  const handleCwdChange = useCallback(
    (cwd: string | null, projectRoot?: string | null) => {
      if (!cwd) return;
      if (suppressCwdBumpRef.current) {
        suppressCwdBumpRef.current = false;
        return;
      }
      const newProject = projectRoot ?? cwd;
      if (selectedSession && worktreePathsEqual(selectedSession.projectRoot ?? selectedSession.cwd, newProject)) {
        return;
      }
      clearAutomationSessionIntent();
      const ref = { environmentId: workspaceStore.getSnapshot().focus.environmentId, path: newProject };
      workspaceStore.openSpace(ref);
      setOpenedSession(null);
      const nextScope = JSON.stringify([
        workspaceStore.getSnapshot().focus.environmentId,
        workspaceStore.getSnapshot().focus.spaceKey,
      ]);
      setNewSession((previous) => {
        if (newProject && !worktreePathsEqual(cwd, newProject)) return { scope: nextScope, cwd };
        return previous?.scope === nextScope && previous.cwd === cwd ? previous : null;
      });
      setSessionKey((k) => k + 1);
      onTopPanelDismiss();
      router.replace("/", { scroll: false });
    },
    [router, selectedSession, onTopPanelDismiss],
  );
  const handleSelectSession = useCallback(
    (session: SessionInfo, isRestore = false, keepSpace = false) => {
      clearAutomationSessionIntent();
      if (!isRestore) {
        openRequest.current += 1;
        setPendingOpen(null);
      }
      const environmentId = session.environmentId;
      const currentFocus = workspaceStore.getSnapshot().focus;
      const keptSpace =
        keepSpace && currentFocus.environmentId === environmentId
          ? ((currentFocus.spaceKey ? parseQualifiedProjectKey(currentFocus.spaceKey)?.path : null) ??
            location?.path ??
            null)
          : null;
      workspaceStore.focusSession({ ...session, environmentId, projectRoot: keptSpace ?? session.projectRoot });
      setSpaceFrozenSessionId(keepSpace ? session.id : null);
      if (!isRestore) onShowChat?.();
      if (!isRestore && selectedSession?.id === session.id && selectedSession.environmentId === environmentId) {
        if (isMobile) onMobileSidebarClose();
        return;
      }
      beginSessionLoadTrace(session.id, isRestore ? "restore" : "selection");
      setNewSessionCwd(null);
      setOpenedSession(session);
      setSessionKey((k) => k + 1);
      setInitialSessionRestored(true);
      if (isMobile && !isRestore) onMobileSidebarClose();
      if (isRestore) suppressCwdBumpRef.current = true;
      if (!isRestore) {
        router.replace(`?session=${encodeURIComponent(session.id)}`, { scroll: false });
      }
    },
    [router, isMobile, onMobileSidebarClose, onShowChat, selectedSession, location, setNewSessionCwd],
  );
  const handleNewSession = useCallback(
    (_sessionId: string, cwd: string) => {
      clearAutomationSessionIntent();
      openRequest.current += 1;
      setPendingOpen(null);
      const currentFocus = workspaceStore.getSnapshot().focus;
      const root = currentFocus.spaceKey ? parseQualifiedProjectKey(currentFocus.spaceKey)?.path : null;
      const ref = { environmentId: currentFocus.environmentId, path: root ?? cwd };
      workspaceStore.openSpace(ref);
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
  useEffect(() => {
    const offDeep = window.piBridge?.onDeepLinkSession?.((sessionId) => openSessionById(sessionId));
    const offNew = window.piBridge?.onMenu?.("new-session", () => {
      const currentSnapshot = workspaceStore.getSnapshot();
      const currentFocus = currentSnapshot.focus;
      const matchedSession =
        selectedSession?.id === currentFocus.sessionId && selectedSession?.environmentId === currentFocus.environmentId
          ? selectedSession
          : null;
      const currentLocation = resolveWorkspaceLocation(currentSnapshot, matchedSession);
      const scopedNewSessionCwd =
        scope === JSON.stringify([currentFocus.environmentId, currentFocus.spaceKey]) ? newSessionCwd : null;
      const cwd = matchedSession?.cwd ?? scopedNewSessionCwd ?? currentLocation?.path ?? null;
      if (cwd) handleNewSession(createTemporarySessionId(), cwd);
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
  }, [selectedSession, newSessionCwd, scope, onSwitchSessionRequested, openSessionById, handleNewSession]);
  const hydrateSelectedSession = useCallback((sessionId: string, environmentId: EnvironmentId) => {
    void getEnvironmentApiClient(environmentId)
      .listSessions()
      .then((d) => {
        const full = d.sessions.find((s) => s.id === sessionId);
        if (!full) return;
        setOpenedSession((prev) =>
          prev && prev.id === sessionId && prev.environmentId === environmentId && !prev.projectRoot
            ? { ...full, environmentId }
            : prev,
        );
      })
      .catch(() => {});
  }, []);
  const handleSessionCreated = useCallback(
    (session: SessionInfo) => {
      const environmentId = session.environmentId;
      registerEnvironmentSession(environmentId, session.id);
      workspaceStore.focusSession({ ...session, environmentId });
      setNewSessionCwd(null);
      setOpenedSession(session);
      setRefreshKey((k) => k + 1);
      hydrateSelectedSession(session.id, environmentId);
      router.replace(`?session=${encodeURIComponent(session.id)}`, { scroll: false });
    },
    [router, hydrateSelectedSession, setNewSessionCwd],
  );
  const handleSessionForked = useCallback(
    (newSessionId: string) => {
      const environmentId = selectedSession?.environmentId ?? getActiveEnvironmentId();
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
        environmentId,
      }));
      hydrateSelectedSession(newSessionId, environmentId);
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
        if (cwd) {
          const ref = { environmentId: selectedSession.environmentId, path: selectedSession.projectRoot ?? cwd };
          workspaceStore.openSpace(ref);
        }
        setOpenedSession(null);
        setNewSessionCwd(cwd ?? null);
        setSessionKey((k) => k + 1);
        onTopPanelDismiss();
        router.replace("/", { scroll: false });
      }
    },
    [onBeforeSessionDeleted, selectedSession, router, onTopPanelDismiss, setNewSessionCwd],
  );
  const handleInitialRestoreDone = useCallback(() => setInitialSessionRestored(true), []);
  const bumpSessionKey = useCallback(() => setSessionKey((k) => k + 1), []);
  const bumpRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);
  return {
    environmentId: focus.environmentId,
    workspaceSnapshot: snapshot,
    selectedSession,
    spaceFrozenSessionId,
    newSessionCwd,
    location,
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
    openSessionById,
    bumpSessionKey,
    bumpRefresh,
  };
}

export function useAutomationNavigation(options: {
  page: NavPage;
  settingsOpen: boolean;
  automationCwd: string | null;
  prepareAutomationSpace: () => Promise<string | null>;
  onNavigate: (page: NavPage) => void;
  onShowChat: () => void;
  onNewSession: (sessionId: string, cwd: string) => void;
  onOpenSession: (sessionId: string, environmentId: EnvironmentId) => void;
}) {
  const { page, settingsOpen, automationCwd, prepareAutomationSpace } = options;
  const { onNavigate, onShowChat, onNewSession, onOpenSession } = options;
  const [automationTarget, setAutomationTarget] = useState<AutomationRouteTarget | null>(null);
  const [overviewResetKey, setOverviewResetKey] = useState(0);
  const requestVersion = useRef(0);
  const consumeAutomationTarget = useCallback(() => setAutomationTarget(null), []);
  const handleSidebarNavigate = useCallback(
    (target: NavPage) => {
      requestVersion.current += 1;
      setAutomationTarget(null);
      if (target === "automation") setOverviewResetKey((key) => key + 1);
      onNavigate(target);
    },
    [onNavigate],
  );
  useEffect(() => {
    requestVersion.current += 1;
    if (page !== "automation" || settingsOpen) setAutomationTarget(null);
    return () => {
      requestVersion.current += 1;
    };
  }, [page, settingsOpen]);
  useEffect(
    () =>
      subscribeAutomationPageRequest((target) => {
        requestVersion.current += 1;
        setAutomationTarget(target);
        onNavigate("automation");
      }),
    [onNavigate],
  );
  useEffect(
    () =>
      subscribeSealedAutomationSessionRequest((ref) => {
        requestVersion.current += 1;
        clearAutomationSessionIntent();
        setAutomationTarget(null);
        onNavigate("chat");
        onOpenSession(ref.sessionId, ref.environmentId);
      }),
    [onNavigate, onOpenSession],
  );
  useEffect(
    () =>
      subscribeAutomationAiSessionRequest((intent) => {
        const version = ++requestVersion.current;
        clearAutomationSessionIntent();
        const origin = workspaceStore.getSnapshot().focus;
        void (async () => {
          const targetEnvId = intent.environmentId ?? PRIMARY_ENVIRONMENT_ID;
          const connection = getEnvironmentConnection(targetEnvId);
          let sessionCwd = intent.cwd?.trim() ?? "";
          if (intent.mode === "adjust") {
            const valid =
              intent.taskId && sessionCwd
                ? await connection.call("system.validateCwd", { path: sessionCwd }).catch(() => null)
                : null;
            sessionCwd = valid?.ok ? (valid.path ?? sessionCwd) : "";
          }
          if (!sessionCwd) {
            sessionCwd =
              targetEnvId === PRIMARY_ENVIRONMENT_ID
                ? ((automationCwd ?? (await prepareAutomationSpace().catch(() => null)))?.trim() ?? "")
                : ((await connection.call("system.automationCwd").catch(() => null))?.cwd?.trim() ?? "");
            sessionCwd ||= (await connection.call("system.defaultCwd").catch(() => null))?.cwd?.trim() ?? "";
          }
          if (!sessionCwd || version !== requestVersion.current || workspaceStore.getSnapshot().focus !== origin)
            return;
          setAutomationTarget(null);
          onShowChat();
          workspaceStore.openSpace({ environmentId: targetEnvId, path: sessionCwd });
          onNewSession(createTemporarySessionId(), sessionCwd);
          setAutomationSessionIntent({ ...intent, environmentId: targetEnvId, cwd: sessionCwd });
        })().catch((error: unknown) => console.error("Automation session preparation failed", error));
      }),
    [automationCwd, prepareAutomationSpace, onShowChat, onNewSession],
  );
  const handleCloseAutomation = useCallback(() => {
    requestVersion.current += 1;
    setAutomationTarget(null);
    onShowChat();
  }, [onShowChat]);
  return { automationTarget, consumeAutomationTarget, overviewResetKey, handleSidebarNavigate, handleCloseAutomation };
}
