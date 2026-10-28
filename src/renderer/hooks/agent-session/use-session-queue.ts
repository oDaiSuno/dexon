import { sendAgentCommand } from "@/lib/agent-client";
import { useCallback } from "react";
import { ThinkingLevelOption, UseAgentSessionOptions } from "./shared";
import type { SessionExtensions } from "./use-session-extensions";
import type { SessionState } from "./use-session-state";
type Dependencies = Pick<
  SessionState,
  "sessionIdRef" | "t" | "setQueuedMessages" | "setThinkingLevel" | "ensuringNewSessionRef"
> &
  Pick<SessionExtensions, "addNotice">;
export function useSessionQueue(context: Dependencies, opts: UseAgentSessionOptions) {
  const { sessionIdRef, addNotice, t, setQueuedMessages, setThinkingLevel, ensuringNewSessionRef } = context;

  // Queued (undelivered) messages live in the queue panel only; the chat gets
  // the real user message when pi delivers it (user message_end event). An
  // optimistic chat bubble here would duplicate the queue panel and turn into
  // a ghost message if the queue is recalled.
  const handleSteer = useCallback(
    async (message: string) => {
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
        await sendAgentCommand(sid, {
          type: "steer",
          message,
        });
      } catch (error) {
        console.error("Failed to steer:", error);
        addNotice({
          type: "error",
          message: t("steerFailedNotQueued", "Unable to steer the running agent. The message was not queued."),
        });
        throw error;
      }
    },
    [addNotice, sessionIdRef, t],
  );

  const handlePromptWithStreamingBehavior = useCallback(
    async (message: string, behavior: "steer" | "followUp") => {
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
        await sendAgentCommand(sid, {
          type: "prompt",
          message,
          streamingBehavior: behavior,
        });
      } catch (error) {
        console.error("Failed to queue prompt:", error);
        addNotice({
          type: "error",
          message: t("promptQueueFailedNotQueued", "Unable to queue this prompt. The message was not queued."),
        });
        throw error;
      }
    },
    [addNotice, sessionIdRef, t],
  );

  const handleFollowUp = useCallback(
    async (message: string) => {
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
        await sendAgentCommand(sid, {
          type: "follow_up",
          message,
        });
      } catch (error) {
        console.error("Failed to follow up:", error);
        addNotice({
          type: "error",
          message: t("followUpQueueFailedNotQueued", "Unable to queue this follow-up. The message was not queued."),
        });
        throw error;
      }
    },
    [addNotice, sessionIdRef, t],
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
      // clearQueue also emits an empty queue_update, but that only reaches us
      // while the stream is connected — clear locally so idle recalls update the UI.
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
      setThinkingLevel(level);
      const sid = sessionIdRef.current ?? (await ensuringNewSessionRef.current);
      if (!sid) return;
      try {
        await sendAgentCommand(sid, { type: "set_thinking_level", level });
      } catch (e) {
        console.error("Failed to set thinking level:", e);
      }
    },
    [ensuringNewSessionRef, sessionIdRef, setThinkingLevel],
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
