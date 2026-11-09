import { sendAgentCommand } from "@/lib/agent-client";
import { getEnvironmentApiClient } from "@/lib/api-client";
import { canSendToEnvironment } from "@/lib/space-attribution";
import { connectTimedEventStream, type EventStreamConnectionResult } from "@/lib/event-stream-connection";
import { carryUnsavedMessages } from "@/lib/unsaved-messages";
import type { InteractiveSnapshot } from "@shared/interactive-tools";
import { useCallback } from "react";
import {
  AgentEvent,
  EVENT_STREAM_CONNECT_TIMEOUT_MS,
  EventStreamConnectionError,
  SessionCommandInfo,
  isSessionCommand,
  SlashCommandsResponse,
} from "./shared";
import type { SessionState } from "./use-session-state";
import type { SessionEvents } from "./use-session-events";
type Dependencies = Pick<
  SessionState,
  | "environmentId"
  | "t"
  | "interactiveTools"
  | "sessionIdRef"
  | "isNew"
  | "newSessionCwd"
  | "newSessionPromotedRef"
  | "onSessionCreated"
  | "ensuringNewSessionRef"
  | "newSessionModel"
  | "newSessionDefaultModel"
  | "setPendingModel"
  | "thinkingLevel"
  | "setSlashCommands"
  | "setSlashCommandsLoading"
  | "eventConnectionManager"
  | "handleAgentEventRef"
> &
  Pick<SessionEvents, "reconcileAgentState">;
export function useSessionConnection(context: Dependencies) {
  const {
    environmentId,
    t,
    interactiveTools,
    sessionIdRef,
    isNew,
    newSessionCwd,
    newSessionPromotedRef,
    onSessionCreated,
    ensuringNewSessionRef,
    newSessionModel,
    newSessionDefaultModel,
    setPendingModel,
    thinkingLevel,
    setSlashCommands,
    setSlashCommandsLoading,
    eventConnectionManager,
    handleAgentEventRef,
    reconcileAgentState,
  } = context;

  const promoteNewSession = useCallback(
    (messageCount = 0, firstMessage = "(no messages)") => {
      const sid = sessionIdRef.current;
      if (!isNew || !newSessionCwd || !sid || newSessionPromotedRef.current) return;
      newSessionPromotedRef.current = true;
      carryUnsavedMessages(newSessionCwd, sid, environmentId);
      onSessionCreated?.({
        id: sid,
        environmentId,
        path: "",
        cwd: newSessionCwd,
        name: undefined,
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        messageCount,
        firstMessage,
      });
    },
    [environmentId, isNew, newSessionCwd, newSessionPromotedRef, onSessionCreated, sessionIdRef],
  );

  const ensureNewSession = useCallback(async () => {
    if (sessionIdRef.current) return sessionIdRef.current;
    if (!isNew || !newSessionCwd) return sessionIdRef.current;
    if (ensuringNewSessionRef.current) return ensuringNewSessionRef.current;

    const promise = (async () => {
      const selectedModel = newSessionModel ?? newSessionDefaultModel;
      if (selectedModel) setPendingModel(selectedModel);
      if (!canSendToEnvironment(environmentId))
        throw new Error(t("remoteAttributionSendHint", "You can send after reconnecting"));
      const result = await getEnvironmentApiClient(environmentId).newAgent({
        cwd: newSessionCwd,
        type: "ensure_session",
        ...(selectedModel ? { provider: selectedModel.provider, modelId: selectedModel.modelId } : {}),
        ...(thinkingLevel ? { thinkingLevel } : {}),
      });
      const realId = result.sessionId;
      sessionIdRef.current = realId;
      interactiveTools.bindSession(realId);
      return realId;
    })();

    ensuringNewSessionRef.current = promise;
    try {
      return await promise;
    } finally {
      ensuringNewSessionRef.current = null;
    }
  }, [
    environmentId,
    t,
    sessionIdRef,
    isNew,
    newSessionCwd,
    ensuringNewSessionRef,
    newSessionModel,
    newSessionDefaultModel,
    setPendingModel,
    thinkingLevel,
    interactiveTools,
  ]);

  const loadSlashCommands = useCallback(async () => {
    const sid = sessionIdRef.current ?? (await ensureNewSession());
    if (!sid) {
      setSlashCommands([]);
      return [] as SessionCommandInfo[];
    }
    setSlashCommandsLoading(true);
    try {
      const data = await sendAgentCommand<SlashCommandsResponse>(sid, { type: "get_commands" });
      const commands = (data?.commands ?? []).filter(isSessionCommand);
      setSlashCommands(commands);
      return commands;
    } catch (e) {
      console.error("Failed to load slash commands:", e);
      setSlashCommands([]);
      return [] as SessionCommandInfo[];
    } finally {
      setSlashCommandsLoading(false);
    }
  }, [ensureNewSession, sessionIdRef, setSlashCommands, setSlashCommandsLoading]);

  const connectEvents = useCallback(
    async (sid: string): Promise<EventStreamConnectionResult> => {
      return connectTimedEventStream({
        manager: eventConnectionManager,
        subscribe: (onEvent) =>
          getEnvironmentApiClient(environmentId).subscribeAgentEvents(sid, onEvent, () => {
            if (sessionIdRef.current !== sid) return;
            void reconcileAgentState(sid);
          }),
        onEvent: (event) => {
          interactiveTools.bindSession(sid);
          const message = event as AgentEvent;
          if (message.type === "extension_ui_snapshot")
            interactiveTools.reconcile(message.snapshot as InteractiveSnapshot);
          else handleAgentEventRef.current?.(event as AgentEvent);
        },
        timeoutMs: EVENT_STREAM_CONNECT_TIMEOUT_MS,
      });
    },
    [environmentId, eventConnectionManager, handleAgentEventRef, interactiveTools, sessionIdRef, reconcileAgentState],
  );

  const ensureEventsConnected = useCallback(
    async (sid: string) => {
      const result = await connectEvents(sid);
      if (result.status === "connected") return;
      throw new EventStreamConnectionError(result.status);
    },
    [connectEvents],
  );
  return { ensureNewSession, ensureEventsConnected, promoteNewSession, loadSlashCommands, connectEvents };
}
export type SessionConnection = ReturnType<typeof useSessionConnection>;
