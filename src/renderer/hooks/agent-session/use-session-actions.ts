import { sendAgentCommand } from "@/lib/agent-client";
import { requestAutoSessionTitle, shouldAutoTitleMessage } from "@/lib/auto-session-title";
import { sessionClientErrorMessage } from "@/lib/session-error-message";
import { appendLocalHistoryMessage, removeLastHistoryMessage } from "@/lib/session-history-update";
import type { AgentMessage } from "@/lib/types";
import { useCallback } from "react";
import { CompactCommandResult, readCompactResult, userMessageKey } from "./shared";
import type { SessionConnection } from "./use-session-connection";
import type { SessionEvents } from "./use-session-events";
import type { SessionExtensions } from "./use-session-extensions";
import type { SessionHistory } from "./use-session-history";
import type { SessionState } from "./use-session-state";
type Dependencies = Pick<
  SessionState,
  | "agentRunning"
  | "promptRunIdRef"
  | "optimisticUserMessageKeyRef"
  | "agentRunningRef"
  | "setAgentRunning"
  | "setAgentPhase"
  | "dispatch"
  | "pendingScrollToUserRef"
  | "completionScrollAllowedRef"
  | "isNew"
  | "newSessionCwd"
  | "newSessionModel"
  | "sessionIdRef"
  | "ensuringNewSessionRef"
  | "setPendingModel"
  | "newSessionDefaultModel"
  | "session"
  | "t"
  | "setForkingEntryId"
  | "onSessionForked"
  | "setActiveLeafId"
  | "setNewSessionModel"
  | "setCurrentModelOverride"
  | "isCompacting"
  | "setIsCompacting"
  | "setCompactError"
  | "setCompactResult"
> &
  Pick<SessionHistory, "updateHistory" | "loadContext" | "refreshContextUsage" | "contextGenRef" | "loadSession"> &
  Pick<SessionConnection, "ensureNewSession" | "ensureEventsConnected" | "promoteNewSession"> &
  Pick<SessionEvents, "waitForPromptSettlement"> &
  Pick<SessionExtensions, "addNotice">;
export function useSessionActions(context: Dependencies) {
  const {
    agentRunning,
    promptRunIdRef,
    updateHistory,
    optimisticUserMessageKeyRef,
    agentRunningRef,
    setAgentRunning,
    setAgentPhase,
    dispatch,
    pendingScrollToUserRef,
    completionScrollAllowedRef,
    isNew,
    newSessionCwd,
    newSessionModel,
    sessionIdRef,
    ensuringNewSessionRef,
    ensureNewSession,
    setPendingModel,
    ensureEventsConnected,
    promoteNewSession,
    newSessionDefaultModel,
    session,
    waitForPromptSettlement,
    addNotice,
    t,
    setForkingEntryId,
    onSessionForked,
    setActiveLeafId,
    loadContext,
    refreshContextUsage,
    contextGenRef,
    setNewSessionModel,
    setCurrentModelOverride,
    isCompacting,
    setIsCompacting,
    setCompactError,
    setCompactResult,
    loadSession,
  } = context;

  const handleSend = useCallback(
    async (message: string) => {
      const trimmedMessage = message.trim();
      if (!trimmedMessage) return;
      if (agentRunning) return;
      const isSlashCommandPrompt = trimmedMessage.startsWith("/");
      const promptRunId = promptRunIdRef.current + 1;

      const userMsg: AgentMessage = {
        role: "user",
        content: message,
        timestamp: Date.now(),
      };
      updateHistory((current) => appendLocalHistoryMessage(current, userMsg));
      optimisticUserMessageKeyRef.current = userMessageKey(userMsg);
      promptRunIdRef.current = promptRunId;
      agentRunningRef.current = true;
      setAgentRunning(true);
      setAgentPhase(isSlashCommandPrompt ? { kind: "running_command" } : { kind: "waiting_model" });
      dispatch({ type: "start" });
      pendingScrollToUserRef.current = true;
      completionScrollAllowedRef.current = true;

      try {
        let sentSessionId: string | null = null;
        if (isNew && newSessionCwd) {
          const selectedModel = newSessionModel;
          const existingSid = sessionIdRef.current ?? (await ensuringNewSessionRef.current);
          const sid = existingSid ?? (await ensureNewSession());

          if (sid) {
            sentSessionId = sid;
            if (selectedModel) {
              setPendingModel(selectedModel);
              if (existingSid) {
                await sendAgentCommand(sid, {
                  type: "set_model",
                  provider: selectedModel.provider,
                  modelId: selectedModel.modelId,
                });
              }
            }
            await ensureEventsConnected(sid);
            await sendAgentCommand(sid, {
              type: "prompt",
              message,
            });
            promoteNewSession(1, message);
            // Auto-title the brand-new session from its first message. Fire and
            // forget: generation is a silent background LLM request and the Host
            // applies it with a rename guard (a manual rename always wins).
            const titleModel = newSessionModel ?? newSessionDefaultModel;
            if (shouldAutoTitleMessage(trimmedMessage)) {
              void requestAutoSessionTitle({
                sessionId: sid,
                message: trimmedMessage,
                ...(titleModel ? { provider: titleModel.provider, modelId: titleModel.modelId } : {}),
              });
            }
          }
        } else if (session) {
          sentSessionId = session.id;
          await ensureEventsConnected(session.id);
          await sendAgentCommand(session.id, {
            type: "prompt",
            message,
          });
        }
        if (isSlashCommandPrompt && sentSessionId) {
          void waitForPromptSettlement(sentSessionId, promptRunId);
        }
      } catch (e) {
        console.error("Failed to send message:", e);
        const optimisticKey = optimisticUserMessageKeyRef.current;
        if (optimisticKey) {
          updateHistory((current) => {
            const last = current.messages[current.messages.length - 1];
            return last?.role === "user" && userMessageKey(last) === optimisticKey
              ? removeLastHistoryMessage(current)
              : current;
          });
        }
        addNotice({
          type: "error",
          message: sessionClientErrorMessage(e, t, t("messageSendFailed", "Failed to send message.")),
        });
        optimisticUserMessageKeyRef.current = null;
        agentRunningRef.current = false;
        setAgentRunning(false);
        setAgentPhase(null);
        dispatch({ type: "end" });
        // ISSUE-006: rethrow so ChatInput restores the draft
        throw e;
      }
    },
    [
      agentRunning,
      promptRunIdRef,
      updateHistory,
      optimisticUserMessageKeyRef,
      agentRunningRef,
      setAgentRunning,
      setAgentPhase,
      dispatch,
      pendingScrollToUserRef,
      completionScrollAllowedRef,
      isNew,
      newSessionCwd,
      session,
      newSessionModel,
      sessionIdRef,
      ensuringNewSessionRef,
      ensureNewSession,
      ensureEventsConnected,
      promoteNewSession,
      newSessionDefaultModel,
      setPendingModel,
      waitForPromptSettlement,
      addNotice,
      t,
    ],
  );

  const handleAbort = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "abort" });
    } catch (e) {
      console.error("Failed to abort:", e);
    }
  }, [sessionIdRef]);

  const handleFork = useCallback(
    async (entryId: string) => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      setForkingEntryId(entryId);
      try {
        const result = await sendAgentCommand<{ cancelled?: boolean; newSessionId?: string }>(sid, {
          type: "fork",
          entryId,
        });
        const { cancelled, newSessionId } = result ?? {};
        if (!cancelled && newSessionId) {
          onSessionForked?.(newSessionId);
        }
      } catch (e) {
        console.error("Fork failed:", e);
      } finally {
        setForkingEntryId(null);
      }
    },
    [onSessionForked, sessionIdRef, setForkingEntryId],
  );

  const handleNavigate = useCallback(
    async (entryId: string) => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      // ISSUE-007: navigate first, then load context for that leaf
      try {
        await sendAgentCommand(sid, { type: "navigate_tree", targetId: entryId });
      } catch (e) {
        console.error("navigate_tree failed:", e);
        return;
      }
      setActiveLeafId(entryId);
      await loadContext(sid, entryId);
      await refreshContextUsage(sid);
    },
    [loadContext, refreshContextUsage, sessionIdRef, setActiveLeafId],
  );

  const handleLeafChange = useCallback(
    async (leafId: string | null) => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      const gen = ++contextGenRef.current;
      if (leafId) {
        try {
          await sendAgentCommand(sid, { type: "navigate_tree", targetId: leafId });
        } catch (e) {
          console.error("navigate_tree failed:", e);
          return;
        }
      }
      if (gen !== contextGenRef.current) return;
      setActiveLeafId(leafId);
      // loadContext bumps gen again — pass through by reusing after navigate
      contextGenRef.current = gen;
      await loadContext(sid, leafId);
      await refreshContextUsage(sid);
    },
    [contextGenRef, loadContext, refreshContextUsage, sessionIdRef, setActiveLeafId],
  );

  const handleLeafChangeFromUi = useCallback(
    (leafId: string | null) => {
      void handleLeafChange(leafId);
    },
    [handleLeafChange],
  );

  const handleModelChange = useCallback(
    async (provider: string, modelId: string) => {
      if (isNew) {
        setNewSessionModel({ provider, modelId });
        setPendingModel({ provider, modelId });
        const sid = sessionIdRef.current ?? (await ensuringNewSessionRef.current);
        if (!sid) return;
        try {
          await sendAgentCommand(sid, { type: "set_model", provider, modelId });
        } catch (e) {
          console.error("Failed to set model:", e);
        }
        return;
      }
      const sid = sessionIdRef.current;
      if (!sid) return;
      try {
        await sendAgentCommand(sid, { type: "set_model", provider, modelId });
        setCurrentModelOverride({ provider, modelId });
        // The context window may differ between models — refresh immediately
        // instead of waiting for the next agent_end.
        await refreshContextUsage(sid);
      } catch (e) {
        console.error("Failed to set model:", e);
      }
    },
    [
      ensuringNewSessionRef,
      isNew,
      refreshContextUsage,
      sessionIdRef,
      setCurrentModelOverride,
      setNewSessionModel,
      setPendingModel,
    ],
  );

  const handleCompact = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid || isCompacting) return;
    setIsCompacting(true);
    setCompactError(null);
    setCompactResult(null);
    try {
      const result = await sendAgentCommand<CompactCommandResult>(sid, { type: "compact" });
      setCompactResult(readCompactResult(result, "manual"));
      await loadSession(sid, true, true);
    } catch (e) {
      setCompactError(e instanceof Error ? e.message : String(e));
      setCompactResult(null);
    } finally {
      setIsCompacting(false);
    }
  }, [isCompacting, loadSession, sessionIdRef, setCompactError, setCompactResult, setIsCompacting]);
  return {
    handleLeafChangeFromUi,
    handleSend,
    handleAbort,
    handleFork,
    handleNavigate,
    handleModelChange,
    handleCompact,
  };
}
export type SessionActions = ReturnType<typeof useSessionActions>;
