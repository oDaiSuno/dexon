import { sendAgentCommand } from "@/lib/agent-client";
import { sessionClientErrorMessage } from "@/lib/session-error-message";
import { appendLocalHistoryMessage } from "@/lib/session-history-update";
import type { AgentMessage } from "@/lib/types";
import { useCallback } from "react";
import { userMessageKey } from "./shared";
import type { OutgoingImage } from "@/components/messages/user-message-editor";
import type { SessionConnection } from "./use-session-connection";
import type { SessionEvents } from "./use-session-events";
import type { SessionExtensions } from "./use-session-extensions";
import type { SessionHistory } from "./use-session-history";
import type { SessionState } from "./use-session-state";

interface SwitchVersionResult {
  cancelled?: boolean;
  leafId?: string | null;
  leftVersionChangedFiles?: boolean;
}

type Dependencies = Pick<
  SessionState,
  | "agentRunning"
  | "agentRunningRef"
  | "setAgentRunning"
  | "setAgentPhase"
  | "dispatch"
  | "promptRunIdRef"
  | "optimisticUserMessageKeyRef"
  | "pendingScrollToUserRef"
  | "completionScrollAllowedRef"
  | "sessionIdRef"
  | "loadedMessagesRef"
  | "loadedEntryIdsRef"
  | "setActiveLeafId"
  | "t"
> &
  Pick<SessionHistory, "updateHistory" | "loadContext" | "refreshContextUsage" | "contextGenRef"> &
  Pick<SessionConnection, "ensureEventsConnected"> &
  Pick<SessionEvents, "waitForPromptSettlement"> &
  Pick<SessionExtensions, "addNotice">;

export function useSessionVersions(context: Dependencies) {
  const {
    agentRunning,
    agentRunningRef,
    setAgentRunning,
    setAgentPhase,
    dispatch,
    promptRunIdRef,
    optimisticUserMessageKeyRef,
    pendingScrollToUserRef,
    completionScrollAllowedRef,
    sessionIdRef,
    loadedMessagesRef,
    loadedEntryIdsRef,
    setActiveLeafId,
    t,
    updateHistory,
    loadContext,
    refreshContextUsage,
    contextGenRef,
    ensureEventsConnected,
    waitForPromptSettlement,
    addNotice,
  } = context;

  const handleEditMessage = useCallback(
    async (entryId: string, message: string, images: OutgoingImage[] = []) => {
      const trimmedMessage = message.trim();
      if (agentRunning) throw new Error("Wait for the current response to finish before editing a message.");
      const sid = sessionIdRef.current;
      if (!sid) throw new Error("No conversation is open for this edit");
      if (!trimmedMessage && images.length === 0) throw new Error("An edited message cannot be empty");

      const previousHistory = {
        messages: loadedMessagesRef.current,
        entryIds: loadedEntryIdsRef.current,
      };
      const userMsg = {
        role: "user",
        content:
          images.length > 0
            ? [...images, ...(trimmedMessage ? [{ type: "text" as const, text: trimmedMessage }] : [])]
            : trimmedMessage,
        timestamp: Date.now(),
      } as AgentMessage;
      updateHistory((current) => {
        const editedIndex = current.entryIds.indexOf(entryId);
        const kept =
          editedIndex >= 0
            ? { messages: current.messages.slice(0, editedIndex), entryIds: current.entryIds.slice(0, editedIndex) }
            : current;
        return appendLocalHistoryMessage(kept, userMsg);
      });

      optimisticUserMessageKeyRef.current = userMessageKey(userMsg);
      promptRunIdRef.current += 1;
      agentRunningRef.current = true;
      setAgentRunning(true);
      setAgentPhase({ kind: "waiting_model" });
      dispatch({ type: "start" });
      pendingScrollToUserRef.current = true;
      completionScrollAllowedRef.current = true;

      try {
        await ensureEventsConnected(sid);
        await sendAgentCommand(sid, {
          type: "edit_message",
          entryId,
          message: trimmedMessage,
          ...(images.length > 0 ? { images } : {}),
        });
        if (trimmedMessage.startsWith("/")) void waitForPromptSettlement(sid, promptRunIdRef.current);
      } catch (e) {
        console.error("Failed to edit message:", e);
        updateHistory(() => previousHistory);
        optimisticUserMessageKeyRef.current = null;
        agentRunningRef.current = false;
        setAgentRunning(false);
        setAgentPhase(null);
        dispatch({ type: "end" });
        addNotice({
          type: "error",
          message: sessionClientErrorMessage(e, t, t("messageEditFailed", "The message could not be edited.")),
        });
        throw e;
      }
    },
    [
      addNotice,
      agentRunning,
      agentRunningRef,
      completionScrollAllowedRef,
      dispatch,
      ensureEventsConnected,
      loadedEntryIdsRef,
      loadedMessagesRef,
      optimisticUserMessageKeyRef,
      pendingScrollToUserRef,
      promptRunIdRef,
      sessionIdRef,
      setAgentPhase,
      setAgentRunning,
      t,
      updateHistory,
      waitForPromptSettlement,
    ],
  );

  const handleSwitchVersion = useCallback(
    async (entryId: string) => {
      const sid = sessionIdRef.current;
      if (!sid || agentRunning) return;
      const gen = ++contextGenRef.current;
      let result: SwitchVersionResult | undefined;
      try {
        result = await sendAgentCommand<SwitchVersionResult>(sid, { type: "switch_version", entryId });
      } catch (e) {
        console.error("switch_version failed:", e);
        return;
      }
      if (result?.cancelled) return;
      if (gen !== contextGenRef.current) return;
      const leafId = result?.leafId ?? null;
      setActiveLeafId(leafId);
      contextGenRef.current = gen;
      await loadContext(sid, leafId);
      await refreshContextUsage(sid);
      if (result?.leftVersionChangedFiles) {
        addNotice({
          type: "warning",
          message: t("versionFilesNotUndone", "File changes made by the previous version were not undone."),
        });
      }
    },
    [addNotice, agentRunning, contextGenRef, loadContext, refreshContextUsage, sessionIdRef, setActiveLeafId, t],
  );

  return { handleEditMessage, handleSwitchVersion };
}
export type SessionVersions = ReturnType<typeof useSessionVersions>;
