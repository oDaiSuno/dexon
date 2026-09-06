import type { SessionRuntimeState } from "@contract/types";
import { agentState } from "@/lib/api-client";
import { NOTICE_VISIBLE_MS, type NoticeType } from "@/lib/notice-queue";
import type { ExtensionUiRequest } from "@/lib/types";
import { useCallback, useEffect } from "react";
import { UseAgentSessionOptions, createNoticeId } from "./shared";
import type { SessionState } from "./use-session-state";
type Dependencies = Pick<
  SessionState,
  "sessionIdRef" | "interactiveTools" | "dispatchNotice" | "setExtensionStatuses" | "setExtensionWidgets"
>;
export function useSessionExtensions(context: Dependencies, opts: UseAgentSessionOptions) {
  const { sessionIdRef, interactiveTools, dispatchNotice, setExtensionStatuses, setExtensionWidgets } = context;

  useEffect(() => {
    let disposed = false;
    const reconcile = async () => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      const version = interactiveTools.getVersion();
      try {
        const state = await agentState(sid);
        if (!disposed && version === interactiveTools.getVersion())
          interactiveTools.reconcile((state.state as SessionRuntimeState | undefined)?.extensionUi ?? null);
      } catch {
        /* A disconnected host does not authorize deleting a draft. */
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void reconcile();
    };
    const timer = setInterval(() => void reconcile(), 15000);
    window.addEventListener("online", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener("online", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [interactiveTools, sessionIdRef]);

  const addNotice = useCallback(
    (notice: { id?: string; message: string; type?: NoticeType }) => {
      const message = notice.message.trim();
      if (!message) return;
      dispatchNotice({
        type: "add",
        notice: {
          id: notice.id ?? createNoticeId(),
          message,
          type: notice.type ?? "info",
          expiresAt: Date.now() + NOTICE_VISIBLE_MS,
        },
      });
    },
    [dispatchNotice],
  );

  const handleExtensionUiRequest = useCallback(
    (request: ExtensionUiRequest) => {
      switch (request.method) {
        case "select":
        case "confirm":
        case "input":
        case "editor":
        case "questionnaire":
        case "custom":
          // Interactive requests are consumed atomically from the host snapshot.
          break;
        case "notify": {
          addNotice({
            id: request.id,
            message: request.message,
            type: request.notifyType ?? "info",
          });
          break;
        }
        case "setStatus":
          setExtensionStatuses((prev) => {
            const rest = prev.filter((item) => item.key !== request.statusKey);
            return request.statusText ? [...rest, { key: request.statusKey, text: request.statusText }] : rest;
          });
          break;
        case "setWidget":
          setExtensionWidgets((prev) => {
            const rest = prev.filter((item) => item.key !== request.widgetKey);
            return request.widgetLines
              ? [
                  ...rest,
                  {
                    key: request.widgetKey,
                    lines: request.widgetLines,
                    placement: request.widgetPlacement ?? "aboveEditor",
                  },
                ]
              : rest;
          });
          break;
        case "setTitle":
          if (request.title) document.title = request.title;
          break;
        case "set_editor_text":
          opts.chatInputRef?.current?.insertText(request.text);
          break;
      }
    },
    [addNotice, opts.chatInputRef, setExtensionStatuses, setExtensionWidgets],
  );
  return { addNotice, handleExtensionUiRequest };
}
export type SessionExtensions = ReturnType<typeof useSessionExtensions>;
