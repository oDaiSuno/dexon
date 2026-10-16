import { useEffect, useRef } from "react";
import type { SessionInfo } from "@/lib/types";
import { resolveInitialSessionRestore } from "@/lib/session-list";

export function useInitialSessionRestore({
  sessions,
  initialSessionId,
  loading,
  error,
  setSelectedCwd,
  onSelectSession,
  onInitialRestoreDone,
}: {
  sessions: SessionInfo[];
  initialSessionId: string | null | undefined;
  loading: boolean;
  error: string | null;
  setSelectedCwd: (cwd: string) => void;
  onSelectSession: (session: SessionInfo, isRestore?: boolean) => void;
  onInitialRestoreDone?: () => void;
}) {
  const restoredRef = useRef(false);
  useEffect(() => {
    const restore = resolveInitialSessionRestore(
      sessions,
      initialSessionId,
      loading,
      error !== null,
      restoredRef.current,
    );
    if (restore.status === "wait") return;
    if (restore.status === "restore") {
      restoredRef.current = true;
      setSelectedCwd(restore.session.cwd);
      onSelectSession(restore.session, true);
      return;
    }
    if (restore.status === "not-found") {
      restoredRef.current = true;
      onInitialRestoreDone?.();
    }
  }, [sessions, error, initialSessionId, loading, onInitialRestoreDone, onSelectSession, setSelectedCwd]);
  return restoredRef;
}
