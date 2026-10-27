import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listSessions } from "@/lib/api-client";
import { beginSessionLoadTrace } from "@/lib/session-performance";
import { readSessionIdFromSearch, routerCompat } from "@/lib/router-compat";
import { getSessionCatalog, useSessionCatalog } from "@/lib/session-catalog";
import { subscribeOpenSessionRequests } from "@/lib/session-open-request";
import { requestSessionSearchFocus } from "@/lib/session-search-focus";
import { worktreePathsEqual } from "@shared/worktree-path";
import type { SessionInfo } from "@/lib/types";

// Split from AppShell.tsx in Phase 2: the shell's session/workspace navigation
// owner. Owns the selected session, the effective cwd, the chat remount keys,
// and the session actions arriving from deep links and the desktop menu.
// Pure view state (sidebar open flag, top panel) stays in the composition root
// and is nudged through callbacks.

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
    () => (openedSession && catalog.find((session) => session.id === openedSession.id)) ?? openedSession,
    [catalog, openedSession],
  );
  // When user clicks +, we only store the cwd — no fake session id
  const [newSessionCwd, setNewSessionCwd] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sessionKey, setSessionKey] = useState(0);
  const [activeCwd, setActiveCwd] = useState<string | null>(null);
  const [initialSessionId] = useState<string | null>(() => readSessionIdFromSearch(window.location.search));
  // True once the initial ?session= URL param has been resolved (or confirmed absent)
  const [initialSessionRestored, setInitialSessionRestored] = useState<boolean>(() => !initialSessionId);
  // Suppresses sessionKey bump in handleCwdChange during the initial URL restore
  const suppressCwdBumpRef = useRef(false);

  const openSessionById = useCallback(
    (sessionId: string) => {
      void (async () => {
        try {
          const listed = getSessionCatalog().find((session) => session.id === sessionId);
          const found = listed ?? (await listSessions()).sessions.find((session) => session.id === sessionId);
          if (!found) return;
          onShowChat?.();
          setNewSessionCwd(null);
          setOpenedSession(found as SessionInfo);
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

  // Deep link + menu actions from Electron main
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
    // ISSUE-016: Switch Session palette — focus sidebar / open project list
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
      // Skip if cwd is null (initial mount) or during the initial URL restore.
      if (!cwd) return;
      if (suppressCwdBumpRef.current) {
        suppressCwdBumpRef.current = false;
        return;
      }
      // Worktrees of one repo share a project root. Moving the effective cwd
      // within the same project (e.g. switching worktree, or clicking a session
      // that lives in another worktree) must not close the open session.
      // Path strings may differ in separators/casing depending on their source
      // (session file vs git output), so compare with worktreePathsEqual.
      const newProject = projectRoot ?? cwd;
      if (selectedSession && worktreePathsEqual(selectedSession.projectRoot ?? selectedSession.cwd, newProject)) {
        return;
      }
      // Close any session that belongs to a different project — it no longer
      // matches the selected project directory.
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
    (session: SessionInfo, isRestore = false) => {
      if (!isRestore) onShowChat?.();
      if (!isRestore && selectedSession?.id === session.id) {
        if (isMobile) onMobileSidebarClose();
        return;
      }
      beginSessionLoadTrace(session.id, isRestore ? "restore" : "selection");
      setNewSessionCwd(null);
      setOpenedSession(session);
      setSessionKey((k) => k + 1);
      setInitialSessionRestored(true);
      // On mobile, collapse the overlay drawer so the chat is revealed after pick.
      if (isMobile && !isRestore) onMobileSidebarClose();
      if (isRestore) {
        // Suppress the redundant sessionKey bump that would come from the
        // onCwdChange effect firing after setSelectedCwd in the sidebar
        suppressCwdBumpRef.current = true;
      }
      // Skip router.replace when restoring from URL — the param is already correct
      // and replacing it during the initial desktop restore causes a remount loop
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

  // Client-built transient SessionInfo (new session / fork) lacks the
  // server-computed projectRoot, which the same-project check in
  // handleCwdChange relies on. Hydrate it from the session list so switching
  // worktrees right after creating a session doesn't close the chat.
  const hydrateSelectedSession = useCallback((sessionId: string) => {
    void listSessions()
      .then((d) => {
        const full = d.sessions.find((s) => s.id === sessionId);
        if (!full) return;
        setOpenedSession((prev) => (prev && prev.id === sessionId && !prev.projectRoot ? full : prev));
      })
      .catch(() => {});
  }, []);

  // Called by ChatWindow when a new session gets its real id from pi
  const handleSessionCreated = useCallback(
    (session: SessionInfo) => {
      setNewSessionCwd(null);
      setOpenedSession(session);
      setRefreshKey((k) => k + 1);
      hydrateSelectedSession(session.id);
      router.replace(`?session=${encodeURIComponent(session.id)}`, { scroll: false });
    },
    [router, hydrateSelectedSession],
  );

  const handleSessionForked = useCallback(
    (newSessionId: string) => {
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

  // Adopt a coordinator-pushed space (startup restore, session alignment):
  // update the effective cwd only — pushed values are not user choices, so
  // they must never close an open session or rewrite the URL.
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
