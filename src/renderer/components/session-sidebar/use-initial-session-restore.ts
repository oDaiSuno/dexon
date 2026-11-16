import { useEffect, useRef } from "react";
import type { SessionInfo } from "@/lib/types";
import { resolveInitialSessionRestore } from "@/lib/session-list";

export function useInitialSessionRestore({
  sessions,
  initialSessionId,
  loading,
  error,
  onSelectSession,
  onInitialRestoreDone,
}: {
  sessions: SessionInfo[];
  initialSessionId: string | null | undefined;
  loading: boolean;
  error: string | null;
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
      onSelectSession(restore.session, true);
      return;
    }
    if (restore.status === "not-found") {
      restoredRef.current = true;
      onInitialRestoreDone?.();
    }
  }, [sessions, error, initialSessionId, loading, onInitialRestoreDone, onSelectSession]);
  return restoredRef;
}
