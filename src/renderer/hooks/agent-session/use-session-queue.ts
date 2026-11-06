import { sendAgentCommand } from "@/lib/agent-client";
import { getEnvironmentApiClient } from "@/lib/api-client";
import { canSendToEnvironment } from "@/lib/space-attribution";
import { useCallback } from "react";
import { ThinkingLevelOption, UseAgentSessionOptions } from "./shared";
import type { SessionExtensions } from "./use-session-extensions";
import type { SessionState } from "./use-session-state";
type Dependencies = Pick<
  SessionState,
  "environmentId" | "sessionIdRef" | "t" | "setQueuedMessages" | "modelChoice" | "ensuringNewSessionRef"
> &
  Pick<SessionExtensions, "addNotice">;
export function useSessionQueue(context: Dependencies, opts: UseAgentSessionOptions) {
  const { environmentId, sessionIdRef, addNotice, t, setQueuedMessages, modelChoice, ensuringNewSessionRef } = context;
  const handleSteer = useCallback(
    async (message: string) => {
      if (!canSendToEnvironment(environmentId)) return { ok: false };
      const sid = sessionIdRef.current;
      if (!sid) {
        const error = new Error("The active session is no longer available");
        addNotice({
          type: "error",
          message: t("steerFailedNotQueued", "Unable to steer the running agent. The message was not queued."),
        });
        throw error;
      }
      try {
        await getEnvironmentApiClient(environmentId).agentCommand(sid, {
          type: "steer",
          message,
        });
        return { ok: true };
      } catch (error) {
        console.error("Failed to steer:", error);
        addNotice({
          type: "error",
          message: t("steerFailedNotQueued", "Unable to steer the running agent. The message was not queued."),
        });
        if (!canSendToEnvironment(environmentId)) return { ok: false };
        throw error;
      }
    },
    [environmentId, addNotice, sessionIdRef, t],
  );

  const handlePromptWithStreamingBehavior = useCallback(
    async (message: string, behavior: "steer" | "followUp") => {
      if (!canSendToEnvironment(environmentId)) return { ok: false };
      const sid = sessionIdRef.current;
      if (!sid) {
        const error = new Error("The active session is no longer available");
        addNotice({
          type: "error",
          message: t("promptQueueFailedNotQueued", "Unable to queue this prompt. The message was not queued."),
        });
        throw error;
      }
      try {
        await getEnvironmentApiClient(environmentId).agentCommand(sid, {
          type: "prompt",
          message,
          streamingBehavior: behavior,
        });
        return { ok: true };
      } catch (error) {
        console.error("Failed to queue prompt:", error);
        addNotice({
          type: "error",
          message: t("promptQueueFailedNotQueued", "Unable to queue this prompt. The message was not queued."),
        });
        if (!canSendToEnvironment(environmentId)) return { ok: false };
        throw error;
      }
    },
    [environmentId, addNotice, sessionIdRef, t],
  );

  const handleFollowUp = useCallback(
    async (message: string) => {
      if (!canSendToEnvironment(environmentId)) return { ok: false };
      const sid = sessionIdRef.current;
      if (!sid) {
        const error = new Error("The active session is no longer available");
        addNotice({
          type: "error",
          message: t("followUpQueueFailedNotQueued", "Unable to queue this follow-up. The message was not queued."),
        });
        throw error;
      }
      try {
        await getEnvironmentApiClient(environmentId).agentCommand(sid, {
          type: "follow_up",
          message,
        });
        return { ok: true };
      } catch (error) {
        console.error("Failed to follow up:", error);
        addNotice({
          type: "error",
          message: t("followUpQueueFailedNotQueued", "Unable to queue this follow-up. The message was not queued."),
        });
        if (!canSendToEnvironment(environmentId)) return { ok: false };
        throw error;
      }
    },
    [environmentId, addNotice, sessionIdRef, t],
  );

  const handleAbortCompaction = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "abort_compaction" });
    } catch (e) {
      console.error("Failed to abort compaction:", e);
    }
  }, [sessionIdRef]);

  const handleRecallQueue = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      const result = await sendAgentCommand<{ steering?: string[]; followUp?: string[] }>(sid, { type: "clear_queue" });
      setQueuedMessages({ steering: [], followUp: [] });
      const texts = [...(result?.steering ?? []), ...(result?.followUp ?? [])];
      if (texts.length > 0) {
        opts.chatInputRef?.current?.prependText(texts.join("\n\n"));
      }
    } catch (e) {
      console.error("Failed to recall queued messages:", e);
      addNotice({ type: "error", message: t("queuedMessagesRecallFailed", "Failed to recall queued messages") });
    }
  }, [sessionIdRef, setQueuedMessages, opts.chatInputRef, addNotice, t]);

  const handleThinkingLevelChange = useCallback(
    async (level: ThinkingLevelOption) => {
      try {
        await modelChoice.choose({ thinkingLevel: level }, async () => {
          const sid = sessionIdRef.current ?? (await ensuringNewSessionRef.current);
          if (sid) await sendAgentCommand(sid, { type: "set_thinking_level", level });
          return {};
        });
      } catch (e) {
        console.error("Failed to set thinking level:", e);
      }
    },
    [ensuringNewSessionRef, modelChoice, sessionIdRef],
  );
  return {
    handleSteer,
    handleFollowUp,
    handlePromptWithStreamingBehavior,
    handleAbortCompaction,
    handleRecallQueue,
    handleThinkingLevelChange,
  };
}
export type SessionQueue = ReturnType<typeof useSessionQueue>;
