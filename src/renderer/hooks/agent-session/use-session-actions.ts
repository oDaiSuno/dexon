import { promptIntentText, readPromptIntent } from "@shared/prompt-intent";
import { sendAgentCommand } from "@/lib/agent-client";
import { requestAutoSessionTitle, shouldAutoTitleMessage } from "@/lib/auto-session-title";
import { sessionClientErrorMessage } from "@/lib/session-error-message";
import { trackSessionNaming } from "@/lib/session-naming-store";
import { appendLocalHistoryMessage, removeLastHistoryMessage } from "@/lib/session-history-update";
import type { AgentMessage } from "@/lib/types";
import { useCallback } from "react";
import {
  CompactCommandResult,
  ThinkingLevelOption,
  isThinkingLevelOption,
  readCompactResult,
  userMessageKey,
} from "./shared";
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
  | "modelChoice"
  | "thinkingLevel"
  | "isCompacting"
  | "setIsCompacting"
  | "setCompactError"
  | "setCompactResult"
> &
  Pick<SessionState, "unsavedMessages"> &
  Pick<SessionHistory, "updateHistory" | "loadContext" | "refreshContextUsage" | "contextGenRef" | "loadSession"> &
  Pick<SessionConnection, "ensureNewSession" | "ensureEventsConnected" | "promoteNewSession"> &
  Pick<SessionEvents, "waitForPromptSettlement"> &
  Pick<SessionExtensions, "addNotice">;

type ModelCommandReply = { thinkingLevel?: unknown };
type NavigateTreeResult = { cancelled?: boolean; leafId?: string | null };

function reportedThinkingLevel(reply: ModelCommandReply | null | undefined): ThinkingLevelOption | null {
  const level = reply?.thinkingLevel;
  return isThinkingLevelOption(level) ? level : null;
}

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
    modelChoice,
    thinkingLevel,
    isCompacting,
    setIsCompacting,
    setCompactError,
    setCompactResult,
    loadSession,
    unsavedMessages,
  } = context;

  const handleSend = useCallback(
    async (message: string) => {
      const trimmedMessage = message.trim();
      if (!trimmedMessage) return;
      if (agentRunning) return;
      const intent = readPromptIntent(message);
      const isConversationTurn = intent.kind !== "command";
      const promptRunId = promptRunIdRef.current + 1;

      const userMsg: AgentMessage = {
        role: "user",
        content: message,
        timestamp: Date.now(),
      };
      const userMsgEntryId = unsavedMessages.nextEntryId();
      updateHistory((current) => appendLocalHistoryMessage(current, userMsg, userMsgEntryId));
      optimisticUserMessageKeyRef.current = userMessageKey(userMsg);
      promptRunIdRef.current = promptRunId;
      agentRunningRef.current = true;
      setAgentRunning(true);
      setAgentPhase(isConversationTurn ? { kind: "waiting_model" } : { kind: "running_command" });
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
                const chosenLevel = thinkingLevel;
                await modelChoice.choose({ model: selectedModel }, async () => {
                  const reply = await sendAgentCommand<ModelCommandReply>(sid, {
                    type: "set_model",
                    provider: selectedModel.provider,
                    modelId: selectedModel.modelId,
                  });
                  if (!chosenLevel) return { thinkingLevel: reportedThinkingLevel(reply) };
                  await sendAgentCommand(sid, { type: "set_thinking_level", level: chosenLevel });
                  return { thinkingLevel: chosenLevel };
                });
              }
            }
            await ensureEventsConnected(sid);
            await sendAgentCommand(sid, {
              type: "prompt",
              message,
            });
            promoteNewSession(1, promptIntentText(intent));
            // Auto-title the brand-new session from its first message. Fire and
            // forget: generation is a silent background LLM request and the Host
            // applies it with a rename guard (a manual rename always wins).
            const titleModel = newSessionModel ?? newSessionDefaultModel;
            if (shouldAutoTitleMessage(message)) {
              void trackSessionNaming(sid, () =>
                requestAutoSessionTitle({
                  sessionId: sid,
                  message: trimmedMessage,
                  ...(titleModel ? { provider: titleModel.provider, modelId: titleModel.modelId } : {}),
                }),
              );
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
        if (!isConversationTurn && sentSessionId) {
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
      modelChoice,
      thinkingLevel,
      waitForPromptSettlement,
      addNotice,
      t,
      unsavedMessages,
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
          position: "at",
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

  const handleLeafChange = useCallback(
    async (leafId: string | null) => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      const gen = ++contextGenRef.current;
      let actualLeafId = leafId;
      if (leafId) {
        try {
          const result = await sendAgentCommand<NavigateTreeResult>(sid, { type: "navigate_tree", targetId: leafId });
          if (result?.cancelled) return;
          if (result?.leafId !== undefined) actualLeafId = result.leafId;
        } catch (e) {
          console.error("navigate_tree failed:", e);
          return;
        }
      }
      if (gen !== contextGenRef.current) return;
      setActiveLeafId(actualLeafId);
      // loadContext bumps gen again — pass through by reusing after navigate
      contextGenRef.current = gen;
      await loadContext(sid, actualLeafId);
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
      const model = { provider, modelId };
      if (isNew) {
        setNewSessionModel(model);
        setPendingModel(model);
        try {
          await modelChoice.choose({ model, thinkingLevel: null }, async () => {
            const sid = sessionIdRef.current ?? (await ensuringNewSessionRef.current);
            if (!sid) return {};
            const reply = await sendAgentCommand<ModelCommandReply>(sid, { type: "set_model", provider, modelId });
            return { thinkingLevel: reportedThinkingLevel(reply) };
          });
        } catch (e) {
          console.error("Failed to set model:", e);
        }
        return;
      }
      const sid = sessionIdRef.current;
      if (!sid) return;
      try {
        await modelChoice.choose({ model }, async () => {
          const reply = await sendAgentCommand<ModelCommandReply>(sid, { type: "set_model", provider, modelId });
          return { thinkingLevel: reportedThinkingLevel(reply) };
        });
        // The context window may differ between models — refresh immediately
        // instead of waiting for the next agent_end.
        await refreshContextUsage(sid);
      } catch (e) {
        console.error("Failed to set model:", e);
      }
    },
    [ensuringNewSessionRef, isNew, modelChoice, refreshContextUsage, sessionIdRef, setNewSessionModel, setPendingModel],
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
    handleModelChange,
    handleCompact,
  };
}
export type SessionActions = ReturnType<typeof useSessionActions>;
