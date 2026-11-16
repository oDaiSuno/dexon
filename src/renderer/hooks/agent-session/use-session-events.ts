import { PRIMARY_ENVIRONMENT_ID } from "@contract/environment";
import { isSessionTransportClosed, sessionClientErrorMessage } from "@/lib/session-error-message";
import { getEnvironmentApiClient } from "@/lib/api-client";
import { normalizeToolCalls } from "@/lib/normalize";
import {
  appendLocalHistoryMessage,
  nameLastHistoryEntry,
  renameHistoryEntry,
  replaceLastHistoryMessage,
} from "@/lib/session-history-update";
import type { ThinkingExpansionStore } from "@/lib/thinking-expansion-store";
import type { AgentMessage, ExtensionUiRequest } from "@/lib/types";
import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import {
  AGENT_STATE_RECONCILE_MS,
  AgentEvent,
  AgentStateResponse,
  PROMPT_SETTLE_INITIAL_DELAY_MS,
  PROMPT_SETTLE_MAX_MS,
  PROMPT_SETTLE_POLL_MS,
  delay,
  isNearBottomExcludingSpacer,
  normalizeQueuedMessages,
  phaseForStreamingMessage,
  readCompactResult,
  userMessageKey,
} from "./shared";
import type { SessionExtensions } from "./use-session-extensions";
import type { SessionHistory } from "./use-session-history";
import type { SessionState } from "./use-session-state";
type Dependencies = Pick<
  SessionState,
  | "environmentId"
  | "setError"
  | "sessionIdRef"
  | "promptRunIdRef"
  | "optimisticUserMessageKeyRef"
  | "agentRunningRef"
  | "setAgentRunning"
  | "setAgentPhase"
  | "setRetryInfo"
  | "dispatch"
  | "onAgentEnd"
  | "setIsCompacting"
  | "setQueuedMessages"
  | "setContextUsage"
  | "setSystemPrompt"
  | "setExtensionStatuses"
  | "setExtensionWidgets"
  | "agentRunning"
  | "scrollContainerRef"
  | "externalTurnAutoFollowRef"
  | "completionScrollAllowedRef"
  | "lastScrollTopRef"
  | "t"
  | "setCompactError"
  | "setCompactResult"
  | "handleAgentEventRef"
  | "unsavedMessages"
> & {
  readingVisibleRef: MutableRefObject<boolean>;
  expansionStores?: readonly ThinkingExpansionStore[];
} & Pick<SessionHistory, "loadSession" | "updateHistory"> &
  Pick<SessionExtensions, "addNotice" | "handleExtensionUiRequest">;
export function useSessionEvents(context: Dependencies) {
  const {
    environmentId,
    setError,
    sessionIdRef,
    promptRunIdRef,
    loadSession,
    optimisticUserMessageKeyRef,
    agentRunningRef,
    setAgentRunning,
    setAgentPhase,
    setRetryInfo,
    dispatch,
    onAgentEnd,
    setIsCompacting,
    setQueuedMessages,
    setContextUsage,
    setSystemPrompt,
    setExtensionStatuses,
    setExtensionWidgets,
    agentRunning,
    scrollContainerRef,
    externalTurnAutoFollowRef,
    completionScrollAllowedRef,
    lastScrollTopRef,
    addNotice,
    t,
    updateHistory,
    setCompactError,
    setCompactResult,
    handleExtensionUiRequest,
    handleAgentEventRef,
    readingVisibleRef,
    unsavedMessages,
    expansionStores,
  } = context;

  const restartNoticeRunRef = useRef<number | null>(null);
  const finishPromptWithoutStream = useCallback(
    async (sid: string | null = sessionIdRef.current, runId?: number) => {
      if (runId !== undefined && promptRunIdRef.current !== runId) return;
      try {
        if (sid) await loadSession(sid);
      } finally {
        if (runId !== undefined && promptRunIdRef.current !== runId) return;
        optimisticUserMessageKeyRef.current = null;
        if (!agentRunningRef.current) return;
        agentRunningRef.current = false;
        setAgentRunning(false);
        setAgentPhase(null);
        setRetryInfo(null);
        dispatch({ type: "end" });
        onAgentEnd?.();
      }
    },
    [
      agentRunningRef,
      dispatch,
      loadSession,
      onAgentEnd,
      optimisticUserMessageKeyRef,
      promptRunIdRef,
      sessionIdRef,
      setAgentPhase,
      setAgentRunning,
      setRetryInfo,
    ],
  );

  const waitForPromptSettlement = useCallback(
    async (sid: string, runId?: number) => {
      await delay(PROMPT_SETTLE_INITIAL_DELAY_MS);
      const startedAt = Date.now();

      while (agentRunningRef.current && Date.now() - startedAt < PROMPT_SETTLE_MAX_MS) {
        if (runId !== undefined && promptRunIdRef.current !== runId) return;
        try {
          const data = await getEnvironmentApiClient(environmentId).agentState(sid);
          const state = data.state as AgentStateResponse | undefined;
          if (!data.running || !state || (!state.isStreaming && !state.isPromptRunning)) {
            await finishPromptWithoutStream(sid, runId);
            return;
          }
        } catch {}
        await delay(PROMPT_SETTLE_POLL_MS);
      }
    },
    [environmentId, agentRunningRef, finishPromptWithoutStream, promptRunIdRef],
  );
  const reconcileAgentState = useCallback(
    async (sid: string) => {
      const runId = promptRunIdRef.current;
      try {
        const data = await getEnvironmentApiClient(environmentId).agentState(sid);
        if (promptRunIdRef.current !== runId || sessionIdRef.current !== sid) return;
        const state = (data.state ?? undefined) as AgentStateResponse | undefined;
        setIsCompacting(state?.isCompacting ?? false);
        setQueuedMessages(normalizeQueuedMessages(state?.queuedMessages));
        const busy = data.running && state && (state.isStreaming || state.isPromptRunning || state.isCompacting);
        if (state) {
          if (state.contextUsage !== undefined) setContextUsage(state.contextUsage ?? null);
          if (state.systemPrompt !== undefined) setSystemPrompt(state.systemPrompt ?? null);
          if (state.extensionStatuses !== undefined) setExtensionStatuses(state.extensionStatuses ?? []);
          if (state.extensionWidgets !== undefined) setExtensionWidgets(state.extensionWidgets ?? []);
        }
        if (busy) {
          const wasRunning = agentRunningRef.current;
          agentRunningRef.current = true;
          setAgentRunning(true);
          setAgentPhase(state.isStreaming ? { kind: "waiting_model" } : { kind: "running_command" });
          const partial = state.streamingMessage;
          if (partial) {
            dispatch({
              type: "update",
              message: normalizeToolCalls(partial),
              entryId: unsavedMessages.resumeStreaming(partial.timestamp),
            });
          } else if (!wasRunning) dispatch({ type: "start" });
          if (!wasRunning) await loadSession(sid, false, true);
          return;
        }
        if (agentRunningRef.current) await finishPromptWithoutStream(sid, runId);
        else await loadSession(sid, false, true);
      } catch (cause) {
        if (sessionIdRef.current === sid && !isSessionTransportClosed(cause))
          setError(sessionClientErrorMessage(cause, t, t("sessionLoadFailed", "Failed to load session.")));
      }
    },
    [
      environmentId,
      agentRunningRef,
      finishPromptWithoutStream,
      sessionIdRef,
      dispatch,
      setAgentPhase,
      setAgentRunning,
      unsavedMessages,
      loadSession,
      setError,
      t,
      promptRunIdRef,
      setContextUsage,
      setExtensionStatuses,
      setExtensionWidgets,
      setIsCompacting,
      setQueuedMessages,
      setSystemPrompt,
    ],
  );

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

  useEffect(() => {
    agentRunningRef.current = agentRunning;
  }, [agentRunning, agentRunningRef]);

  const expansionStoresRef = useRef<readonly ThinkingExpansionStore[]>(expansionStores ?? []);
  expansionStoresRef.current = expansionStores ?? [];
  const handleAgentEvent = useCallback(
    (event: AgentEvent) => {
      switch (event.type) {
        case "channel_turn_start": {
          if (!readingVisibleRef.current) break;
          const container = scrollContainerRef.current;
          const shouldFollow = container ? isNearBottomExcludingSpacer(container) : true;
          externalTurnAutoFollowRef.current = shouldFollow;
          completionScrollAllowedRef.current = shouldFollow;
          if (container) lastScrollTopRef.current = container.scrollTop;
          break;
        }
        case "channel_turn_end":
        case "channel_turn_error":
          externalTurnAutoFollowRef.current = false;
          break;
        case "agent_start":
          agentRunningRef.current = true;
          unsavedMessages.endStreaming();
          setAgentRunning(true);
          setAgentPhase({ kind: "waiting_model" });
          setRetryInfo((current) => (current ? { ...current, waiting: false } : current));
          dispatch({ type: "start" });
          break;
        case "agent_end":
          if (!agentRunningRef.current) break;
          if (event.willRetry === true) {
            dispatch({ type: "reset" });
            break;
          }
          agentRunningRef.current = false;
          unsavedMessages.endStreaming();
          setAgentRunning(false);
          setAgentPhase(null);
          setRetryInfo(null);
          dispatch({ type: "end" });
          if (sessionIdRef.current) {
            void loadSession(sessionIdRef.current);
            void getEnvironmentApiClient(environmentId)
              .agentState(sessionIdRef.current)
              .then((d) => {
                const state = d.state as AgentStateResponse | undefined;
                if (state?.contextUsage !== undefined) setContextUsage(state.contextUsage ?? null);
                if (state?.systemPrompt !== undefined) setSystemPrompt(state.systemPrompt ?? null);
                if (state?.extensionStatuses !== undefined) setExtensionStatuses(state.extensionStatuses ?? []);
                if (state?.extensionWidgets !== undefined) setExtensionWidgets(state.extensionWidgets ?? []);
                setQueuedMessages(normalizeQueuedMessages(state?.queuedMessages));
              })
              .catch(() => {});
          }
          onAgentEnd?.();
          break;
        case "agent_settled":
          if (!agentRunningRef.current) break;
          void finishPromptWithoutStream(sessionIdRef.current);
          break;
        case "prompt_done":
          if (!agentRunningRef.current) break;
          void finishPromptWithoutStream(sessionIdRef.current);
          break;
        case "prompt_error":
          addNotice({
            type: "error",
            message: (event.errorMessage as string | undefined) ?? t("commandFailed", "Command failed"),
          });
          break;
        case "extension_error":
          addNotice({
            type: "error",
            message: (event.error as string | undefined) ?? t("extensionCommandFailed", "Extension command failed"),
          });
          break;
        case "message_start": {
          if (!agentRunningRef.current) break;
          const msg = event.message as Partial<AgentMessage> | undefined;
          if (msg?.role === "user") break;
          if (msg) {
            dispatch({
              type: "update",
              message: normalizeToolCalls(msg as AgentMessage),
              entryId: unsavedMessages.startStreaming(msg.timestamp),
            });
          }
          setAgentPhase({ kind: "waiting_model" });
          break;
        }
        case "message_update": {
          if (!agentRunningRef.current) break;
          const msg = event.message as Partial<AgentMessage> | undefined;
          if (msg?.role === "user") break;
          if (msg) {
            dispatch({
              type: "update",
              message: normalizeToolCalls(msg as AgentMessage),
              entryId: unsavedMessages.streamingEntryId(msg.timestamp),
            });
          }
          setAgentPhase(phaseForStreamingMessage(msg));
          break;
        }
        case "message_end": {
          if (!agentRunningRef.current) break;
          const completed = event.message as AgentMessage | undefined;
          const streamingEntryId = unsavedMessages.endStreaming();
          if (completed && completed.role === "user") {
            const delivered = normalizeToolCalls(completed);
            const deliveredKey = userMessageKey(delivered);
            const optimisticKey = optimisticUserMessageKeyRef.current;
            optimisticUserMessageKeyRef.current = null;
            let questionEntryId = unsavedMessages.nextEntryId();
            updateHistory((current) => {
              const index = current.messages.length - 1;
              const last = current.messages[index];
              const keepsOptimistic =
                !!optimisticKey && last?.role === "user" && userMessageKey(last) === optimisticKey;
              if (!keepsOptimistic) return appendLocalHistoryMessage(current, delivered, questionEntryId);
              questionEntryId = current.entryIds[index] || questionEntryId;
              return optimisticKey === deliveredKey
                ? nameLastHistoryEntry(current, questionEntryId)
                : replaceLastHistoryMessage(current, delivered, questionEntryId);
            });
            unsavedMessages.awaitSave(questionEntryId);
          } else if (completed) {
            const stamped = { ...normalizeToolCalls(completed), timestamp: Date.now() } as AgentMessage;
            const entryId = streamingEntryId ?? unsavedMessages.nextEntryId();
            updateHistory((current) => appendLocalHistoryMessage(current, stamped, entryId));
            unsavedMessages.awaitSave(entryId);
          }
          dispatch({ type: "reset" });
          setAgentPhase({ kind: "waiting_model" });
          break;
        }
        case "message_saved": {
          const savedEntryId = event.entryId as string | undefined;
          const unsavedEntryId = unsavedMessages.takeAwaitingSave();
          if (!savedEntryId || !unsavedEntryId) break;
          for (const store of expansionStoresRef.current) store.adopt(unsavedEntryId, savedEntryId);
          updateHistory((current) => renameHistoryEntry(current, unsavedEntryId, savedEntryId));
          break;
        }
        case "tool_execution_start": {
          const id = event.toolCallId as string;
          const name = event.toolName as string;
          setAgentPhase((prev) => {
            const tools = prev?.kind === "running_tools" ? [...prev.tools] : [];
            if (!tools.some((t) => t.id === id)) tools.push({ id, name });
            return { kind: "running_tools", tools };
          });
          break;
        }
        case "tool_execution_end": {
          const id = event.toolCallId as string;
          setAgentPhase((prev) => {
            if (prev?.kind !== "running_tools") return prev;
            const tools = prev.tools.filter((t) => t.id !== id);
            if (tools.length === 0) return { kind: "waiting_model" };
            return { kind: "running_tools", tools };
          });
          break;
        }
        case "queue_update":
          setQueuedMessages({
            steering: [...((event.steering as string[] | undefined) ?? [])],
            followUp: [...((event.followUp as string[] | undefined) ?? [])],
          });
          break;
        case "auto_retry_start":
          setRetryInfo({
            attempt: event.attempt as number,
            maxAttempts: event.maxAttempts as number,
            errorMessage: event.errorMessage as string | undefined,
            retryAt: Date.now() + ((event.delayMs as number | undefined) ?? 0),
            waiting: true,
          });
          setAgentPhase(null);
          break;
        case "auto_retry_end":
          setRetryInfo(null);
          if (event.success === false && sessionIdRef.current) void loadSession(sessionIdRef.current);
          break;
        case "auto_compaction_start":
        case "compaction_start":
          setIsCompacting(true);
          setCompactError(null);
          setCompactResult(null);
          break;
        case "auto_compaction_end":
        case "compaction_end":
          setIsCompacting(false);
          if (event.errorMessage) {
            setCompactError(event.errorMessage as string);
            setCompactResult(null);
          } else if (!event.aborted) {
            setCompactResult(readCompactResult(event.result, (event.reason as string | undefined) ?? "auto"));
            if (sessionIdRef.current) void loadSession(sessionIdRef.current, false, true);
          }
          break;
        case "extension_ui_request":
          handleExtensionUiRequest(event as ExtensionUiRequest);
          break;
      }
    },
    [
      environmentId,
      addNotice,
      agentRunningRef,
      completionScrollAllowedRef,
      dispatch,
      externalTurnAutoFollowRef,
      finishPromptWithoutStream,
      handleExtensionUiRequest,
      lastScrollTopRef,
      loadSession,
      onAgentEnd,
      optimisticUserMessageKeyRef,
      scrollContainerRef,
      sessionIdRef,
      setAgentPhase,
      setAgentRunning,
      setCompactError,
      setCompactResult,
      setContextUsage,
      setExtensionStatuses,
      setExtensionWidgets,
      setIsCompacting,
      setQueuedMessages,
      setRetryInfo,
      setSystemPrompt,
      t,
      unsavedMessages,
      updateHistory,
      readingVisibleRef,
    ],
  );
  handleAgentEventRef.current = handleAgentEvent;
  return { waitForPromptSettlement, reconcileAgentState };
}
export type SessionEvents = ReturnType<typeof useSessionEvents>;
