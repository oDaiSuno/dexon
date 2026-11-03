import { useEffect } from "react";
import { useNoticeExpiry } from "../use-notice-expiry";
import type { SessionExtensions } from "./use-session-extensions";
import type { SessionModels } from "./use-session-models";
import type { SessionState } from "./use-session-state";
type Dependencies = Pick<SessionModels, "loadModels" | "cancelModelRefresh"> &
  Pick<SessionExtensions, "addNotice"> &
  Pick<
    SessionState,
    | "modelListSizeRef"
    | "t"
    | "modelsRefreshKey"
    | "newSessionCwd"
    | "session"
    | "compactError"
    | "setCompactError"
    | "compactResult"
    | "setCompactResult"
    | "noticeState"
    | "dispatchNotice"
    | "setSessionStatsOverride"
    | "messages"
    | "contextUsage"
  >;
export function useSessionEffects(context: Dependencies) {
  const {
    loadModels,
    addNotice,
    modelListSizeRef,
    t,
    modelsRefreshKey,
    cancelModelRefresh,
    newSessionCwd,
    session,
    compactError,
    setCompactError,
    compactResult,
    setCompactResult,
    noticeState,
    dispatchNotice,
    setSessionStatsOverride,
    messages,
    contextUsage,
  } = context;

  // Load model list
  useEffect(() => {
    const controller = new AbortController();
    loadModels(controller.signal).catch((e) => {
      if (controller.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
      console.error("Failed to load model directory:", e);
      addNotice({
        type: "warning",
        message:
          modelListSizeRef.current > 0
            ? t(
                "modelDirectoryLoadFailedCached",
                "Unable to load the model directory. Cached models remain available; retry from the model picker.",
              )
            : t(
                "modelDirectoryLoadFailed",
                "Unable to load the model directory. Retry from the model picker or check the Agent Host connection.",
              ),
      });
    });
    return () => controller.abort();
  }, [addNotice, loadModels, modelListSizeRef, modelsRefreshKey, t]);

  useEffect(() => cancelModelRefresh, [cancelModelRefresh, newSessionCwd, session?.cwd]);

  // Compact error auto-dismiss
  useEffect(() => {
    if (!compactError) return;
    const t = setTimeout(() => setCompactError(null), 3000);
    return () => clearTimeout(t);
  }, [compactError, setCompactError]);

  useEffect(() => {
    if (!compactResult) return;
    const t = setTimeout(() => setCompactResult(null), 6000);
    return () => clearTimeout(t);
  }, [compactResult, setCompactResult]);

  useNoticeExpiry(noticeState.visible, dispatchNotice);

  useEffect(() => {
    setSessionStatsOverride(null);
  }, [
    messages.length,
    contextUsage?.tokens,
    contextUsage?.percent,
    contextUsage?.contextWindow,
    setSessionStatsOverride,
  ]);
  return {};
}
export type SessionEffects = ReturnType<typeof useSessionEffects>;
