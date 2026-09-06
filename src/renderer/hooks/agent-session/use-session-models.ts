import { cancelModelsRefresh, listModels, refreshModels as requestModelsRefresh } from "@/lib/api-client";
import type { ModelsListResult } from "@contract/types";
import { useCallback } from "react";
import { ModelEntry } from "./shared";
import type { SessionExtensions } from "./use-session-extensions";
import type { SessionState } from "./use-session-state";
type Dependencies = Pick<
  SessionState,
  | "setModelNames"
  | "setModelThinkingLevels"
  | "setModelThinkingLevelMaps"
  | "modelListSizeRef"
  | "setModelList"
  | "setModelCatalog"
  | "isNew"
  | "setNewSessionDefaultModel"
  | "modelListRequestGateRef"
  | "modelRefreshRequestRef"
  | "setModelRefreshing"
  | "newSessionCwd"
  | "session"
  | "t"
> &
  Pick<SessionExtensions, "addNotice">;
export function useSessionModels(context: Dependencies) {
  const {
    setModelNames,
    setModelThinkingLevels,
    setModelThinkingLevelMaps,
    modelListSizeRef,
    setModelList,
    setModelCatalog,
    isNew,
    setNewSessionDefaultModel,
    modelListRequestGateRef,
    modelRefreshRequestRef,
    setModelRefreshing,
    newSessionCwd,
    session,
    addNotice,
    t,
  } = context;

  const applyModelsResult = useCallback(
    (d: ModelsListResult) => {
      const nextList: ModelEntry[] = d.models ?? [];
      const nameMap = d.nameMap ?? {};
      setModelNames(
        Object.keys(nameMap).length > 0
          ? nameMap
          : Object.fromEntries(nextList.map((m) => [`${m.provider}:${m.id}`, m.name])),
      );
      setModelThinkingLevels(d.thinkingLevels ?? {});
      setModelThinkingLevelMaps(d.thinkingLevelMaps ?? {});
      modelListSizeRef.current = nextList.length;
      setModelList(nextList);
      setModelCatalog(d.catalog);
      if (isNew) {
        const match = d.defaultModel
          ? nextList.find((m) => m.id === d.defaultModel?.modelId && m.provider === d.defaultModel?.provider)
          : undefined;
        const displayModel = match ?? nextList[0];
        setNewSessionDefaultModel(displayModel ? { provider: displayModel.provider, modelId: displayModel.id } : null);
      }
    },
    [
      isNew,
      modelListSizeRef,
      setModelCatalog,
      setModelList,
      setModelNames,
      setModelThinkingLevelMaps,
      setModelThinkingLevels,
      setNewSessionDefaultModel,
    ],
  );

  const loadModels = useCallback(
    async (signal?: AbortSignal) => {
      const generation = modelListRequestGateRef.current.begin();
      const activeRefreshRequestId = modelRefreshRequestRef.current;
      if (activeRefreshRequestId) {
        modelRefreshRequestRef.current = null;
        setModelRefreshing(false);
        void cancelModelsRefresh(activeRefreshRequestId).catch(() => {});
      }
      const modelCwd = newSessionCwd ?? session?.cwd ?? "";
      if (signal?.aborted) return;
      const d = await listModels(modelCwd || undefined);
      if (signal?.aborted || !modelListRequestGateRef.current.isCurrent(generation)) return;
      applyModelsResult(d);
    },
    [
      applyModelsResult,
      modelListRequestGateRef,
      modelRefreshRequestRef,
      newSessionCwd,
      session?.cwd,
      setModelRefreshing,
    ],
  );

  const cancelModelRefresh = useCallback(() => {
    const requestId = modelRefreshRequestRef.current;
    if (!requestId) return;
    modelRefreshRequestRef.current = null;
    modelListRequestGateRef.current.invalidate();
    setModelRefreshing(false);
    void cancelModelsRefresh(requestId).catch(() => {});
  }, [modelListRequestGateRef, modelRefreshRequestRef, setModelRefreshing]);

  const refreshModels = useCallback(async () => {
    const previousRequestId = modelRefreshRequestRef.current;
    if (previousRequestId) void cancelModelsRefresh(previousRequestId).catch(() => {});
    const requestId = `models_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    const generation = modelListRequestGateRef.current.begin();
    modelRefreshRequestRef.current = requestId;
    setModelRefreshing(true);
    const modelCwd = newSessionCwd ?? session?.cwd ?? "";
    try {
      const result = await requestModelsRefresh(modelCwd || undefined, requestId);
      if (modelRefreshRequestRef.current !== requestId || !modelListRequestGateRef.current.isCurrent(generation))
        return;
      applyModelsResult(result);
    } catch {
      if (modelRefreshRequestRef.current !== requestId || !modelListRequestGateRef.current.isCurrent(generation))
        return;
      addNotice({
        type: "error",
        message: t(
          "modelDirectoryRefreshFailed",
          "Unable to refresh the model directory. Cached models remain available.",
        ),
      });
    } finally {
      if (modelRefreshRequestRef.current === requestId) {
        modelRefreshRequestRef.current = null;
        setModelRefreshing(false);
      }
    }
  }, [
    addNotice,
    applyModelsResult,
    modelListRequestGateRef,
    modelRefreshRequestRef,
    newSessionCwd,
    session?.cwd,
    setModelRefreshing,
    t,
  ]);
  return { loadModels, cancelModelRefresh, refreshModels };
}
export type SessionModels = ReturnType<typeof useSessionModels>;
