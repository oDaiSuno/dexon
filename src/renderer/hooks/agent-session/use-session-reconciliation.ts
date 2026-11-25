import { PRIMARY_ENVIRONMENT_ID } from "@contract/environment";
import { useEffect, useRef } from "react";
import { AGENT_STATE_RECONCILE_MS } from "./shared";
import type { SessionExtensions } from "./use-session-extensions";
import type { SessionState } from "./use-session-state";

type Dependencies = Pick<
  SessionState,
  "environmentId" | "agentRunning" | "agentRunningRef" | "promptRunIdRef" | "sessionIdRef" | "t"
> &
  Pick<SessionExtensions, "addNotice"> & {
    reconcileAgentState: (sid: string) => Promise<void>;
  };

export function useSessionReconciliation({
  environmentId,
  agentRunning,
  agentRunningRef,
  promptRunIdRef,
  sessionIdRef,
  t,
  addNotice,
  reconcileAgentState,
}: Dependencies) {
  const restartNoticeRunRef = useRef<number | null>(null);
  useEffect(() => {
    const reconcile = () => {
      const sid = sessionIdRef.current;
      if (sid) void reconcileAgentState(sid);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") reconcile();
    };
    const offRestart =
      environmentId === PRIMARY_ENVIRONMENT_ID
        ? window.piBridge?.onHostRestarted?.(() => {
            if (agentRunningRef.current && restartNoticeRunRef.current !== promptRunIdRef.current) {
              restartNoticeRunRef.current = promptRunIdRef.current;
              addNotice({
                type: "warning",
                message: t(
                  "hostRestartedTurnInterrupted",
                  "The background service restarted and interrupted the current reply.",
                ),
              });
            }
            reconcile();
          })
        : undefined;
    const interval = agentRunning ? setInterval(reconcile, AGENT_STATE_RECONCILE_MS) : undefined;
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", reconcile);
    return () => {
      offRestart?.();
      if (interval) clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", reconcile);
    };
  }, [environmentId, addNotice, agentRunning, agentRunningRef, promptRunIdRef, reconcileAgentState, sessionIdRef, t]);
}
