import { getEnvironmentApiClient } from "@/lib/api-client";
import { environmentRegistry } from "@/lib/environment-registry";
import { PRIMARY_ENVIRONMENT_ID } from "@contract/environment";
import { isRpcError, type ModelsListResult } from "@contract/types";
import { useCallback, useSyncExternalStore } from "react";
import { ModelEntry } from "./shared";
import type { SessionExtensions } from "./use-session-extensions";
import type { SessionState } from "./use-session-state";
type Dependencies = Pick<
  SessionState,
  | "environmentId"
  | "setModelNames"
  | "setModelThinkingLevels"
  | "setModelThinkingLevelMaps"
  | "setModelEffectiveThinkingLevels"
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
    environmentId,
    setModelNames,
    setModelThinkingLevels,
    setModelThinkingLevelMaps,
    setModelEffectiveThinkingLevels,
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

  const getConnectionGeneration = useCallback(() => {
    if (environmentId === PRIMARY_ENVIRONMENT_ID) return 0;
    const view = environmentRegistry.getEnvironments().find((environment) => environment.id === environmentId);
    return view?.enabled && view.status.phase === "connected" ? view.status.generation : null;
  }, [environmentId]);
  const connectionGeneration = useSyncExternalStore(
    environmentRegistry.subscribe,
    getConnectionGeneration,
    getConnectionGeneration,
  );
  const isCurrentConnection = useCallback(
    () => connectionGeneration !== null && connectionGeneration === getConnectionGeneration(),
    [connectionGeneration, getConnectionGeneration],
  );

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
      setModelEffectiveThinkingLevels(d.effectiveThinkingLevels ?? {});
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
      setModelEffectiveThinkingLevels,
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
        if (isCurrentConnection())
          void getEnvironmentApiClient(environmentId)
            .cancelModelsRefresh(activeRefreshRequestId)
            .catch(() => {});
      }
      const modelCwd = newSessionCwd ?? session?.cwd ?? "";
      if (signal?.aborted || !isCurrentConnection()) return;
      try {
        const d = await getEnvironmentApiClient(environmentId).listModels(modelCwd || undefined);
        if (signal?.aborted || !isCurrentConnection() || !modelListRequestGateRef.current.isCurrent(generation)) return;
        applyModelsResult(d);
      } catch (error) {
        if (
          signal?.aborted ||
          !isCurrentConnection() ||
          !modelListRequestGateRef.current.isCurrent(generation) ||
          (isRpcError(error) && error.code === "CLOSED")
        )
          return;
        throw error;
      }
    },
    [
      applyModelsResult,
      environmentId,
      isCurrentConnection,
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
    if (isCurrentConnection())
      void getEnvironmentApiClient(environmentId)
        .cancelModelsRefresh(requestId)
        .catch(() => {});
  }, [environmentId, isCurrentConnection, modelListRequestGateRef, modelRefreshRequestRef, setModelRefreshing]);

  const refreshModels = useCallback(async () => {
    if (!isCurrentConnection()) return;
    const previousRequestId = modelRefreshRequestRef.current;
    if (previousRequestId)
      void getEnvironmentApiClient(environmentId)
        .cancelModelsRefresh(previousRequestId)
        .catch(() => {});
    const requestId = `models_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    const generation = modelListRequestGateRef.current.begin();
    modelRefreshRequestRef.current = requestId;
    setModelRefreshing(true);
    const modelCwd = newSessionCwd ?? session?.cwd ?? "";
    try {
      const result = await getEnvironmentApiClient(environmentId).refreshModels(modelCwd || undefined, requestId);
      if (
        !isCurrentConnection() ||
        modelRefreshRequestRef.current !== requestId ||
        !modelListRequestGateRef.current.isCurrent(generation)
      )
        return;
      applyModelsResult(result);
    } catch (error) {
      if (
        (isRpcError(error) && error.code === "CLOSED") ||
        !isCurrentConnection() ||
        modelRefreshRequestRef.current !== requestId ||
        !modelListRequestGateRef.current.isCurrent(generation)
      )
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
    environmentId,
    isCurrentConnection,
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
