import { sendAgentCommand } from "@/lib/agent-client";
import { newAgent, subscribeAgentEvents } from "@/lib/api-client";
import { connectTimedEventStream, type EventStreamConnectionResult } from "@/lib/event-stream-connection";
import type { InteractiveSnapshot } from "@shared/interactive-tools";
import { useCallback } from "react";
import {
  AgentEvent,
  EVENT_STREAM_CONNECT_TIMEOUT_MS,
  EventStreamConnectionError,
  SlashCommandInfo,
  SlashCommandsResponse,
} from "./shared";
import type { SessionState } from "./use-session-state";
type Dependencies = Pick<
  SessionState,
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
>;
export function useSessionConnection(context: Dependencies) {
  const {
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
  } = context;

  const promoteNewSession = useCallback(
    (messageCount = 0, firstMessage = "(no messages)") => {
      const sid = sessionIdRef.current;
      if (!isNew || !newSessionCwd || !sid || newSessionPromotedRef.current) return;
      newSessionPromotedRef.current = true;
      onSessionCreated?.({
        id: sid,
        path: "",
        cwd: newSessionCwd,
        name: undefined,
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        messageCount,
        firstMessage,
      });
    },
    [isNew, newSessionCwd, newSessionPromotedRef, onSessionCreated, sessionIdRef],
  );

  const ensureNewSession = useCallback(async () => {
    if (sessionIdRef.current) return sessionIdRef.current;
    if (!isNew || !newSessionCwd) return sessionIdRef.current;
    if (ensuringNewSessionRef.current) return ensuringNewSessionRef.current;

    const promise = (async () => {
      const selectedModel = newSessionModel ?? newSessionDefaultModel;
      if (selectedModel) setPendingModel(selectedModel);
      const result = await newAgent({
        cwd: newSessionCwd,
        type: "ensure_session",
        ...(selectedModel ? { provider: selectedModel.provider, modelId: selectedModel.modelId } : {}),
        ...(thinkingLevel !== "auto" ? { thinkingLevel } : {}),
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
      return [] as SlashCommandInfo[];
    }
    setSlashCommandsLoading(true);
    try {
      const data = await sendAgentCommand<SlashCommandsResponse>(sid, { type: "get_commands" });
      // Skill commands are invoked through the ＋ menu's skill picker now;
      // they stay out of the slash palette to keep one path per intent.
      const commands = (data?.commands ?? []).filter((command) => command.source !== "skill");
      setSlashCommands(commands);
      return commands;
    } catch (e) {
      console.error("Failed to load slash commands:", e);
      setSlashCommands([]);
      return [] as SlashCommandInfo[];
    } finally {
      setSlashCommandsLoading(false);
    }
  }, [ensureNewSession, sessionIdRef, setSlashCommands, setSlashCommandsLoading]);

  const connectEvents = useCallback(
    async (sid: string): Promise<EventStreamConnectionResult> => {
      return connectTimedEventStream({
        manager: eventConnectionManager,
        subscribe: (onEvent) => subscribeAgentEvents(sid, onEvent),
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
    [eventConnectionManager, handleAgentEventRef, interactiveTools],
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
