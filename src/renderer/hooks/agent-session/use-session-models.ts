import { lastKnownGoodModels, rememberGoodModels } from "@/lib/last-known-good-models";
import { sessionClientErrorMessage } from "@/lib/session-error-message";
export { clearLastKnownGoodModels } from "@/lib/last-known-good-models";
import { getEnvironmentApiClient } from "@/lib/api-client";
import { environmentRegistry } from "@/lib/environment-registry";
import { PRIMARY_ENVIRONMENT_ID } from "@contract/environment";
import { isRpcError, type ModelsListResult } from "@contract/types";
import { useCallback, useRef, useSyncExternalStore } from "react";
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
  | "setModelCatalogScope"
  | "setModelLoading"
  | "setModelReconnecting"
  | "setModelLoadError"
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
    setModelCatalogScope,
    setModelLoading,
    setModelReconnecting,
    setModelLoadError,
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
    const view = environmentRegistry.getEnvironments().find((environment) => environment.id === environmentId);
    if (environmentId === PRIMARY_ENVIRONMENT_ID && view?.status.phase === "available") return 0;
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

  const locationKey = `${environmentId}\0${newSessionCwd ?? session?.cwd ?? ""}`;
  const loadedLocationRef = useRef<string | null>(null);

  const applyModelsResult = useCallback(
    (d: ModelsListResult, { fromCache = false } = {}) => {
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
      setModelCatalogScope(d.scope ?? null);
      if (!fromCache) {
        rememberGoodModels(locationKey, d);
        setModelLoadError(null);
        setModelReconnecting(false);
      }
      if (isNew && !fromCache) {
        const match = d.defaultModel
          ? nextList.find((m) => m.id === d.defaultModel?.modelId && m.provider === d.defaultModel?.provider)
          : undefined;
        const displayModel = match ?? nextList[0];
        setNewSessionDefaultModel(displayModel ? { provider: displayModel.provider, modelId: displayModel.id } : null);
      }
    },
    [
      isNew,
      locationKey,
      setModelCatalogScope,
      setModelLoadError,
      setModelReconnecting,
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
      if (signal?.aborted) return;
      const cached = lastKnownGoodModels(locationKey);
      if (loadedLocationRef.current !== locationKey) {
        loadedLocationRef.current = locationKey;
        modelListSizeRef.current = 0;
        if (!cached)
          applyModelsResult(
            {
              models: [],
              defaultModel: null,
              thinkingLevels: {},
              thinkingLevelMaps: {},
              effectiveThinkingLevels: {},
              nameMap: {},
              catalog: { source: "cache", refreshed: false, aborted: false, warnings: [] },
            },
            { fromCache: true },
          );
        setNewSessionDefaultModel(null);
        setModelLoadError(null);
      }
      if (modelListSizeRef.current === 0 && cached) applyModelsResult(cached, { fromCache: true });
      setModelReconnecting(!isCurrentConnection());
      if (!isCurrentConnection()) {
        setModelLoading(false);
        return;
      }
      setModelLoading(true);
      try {
        const d = await getEnvironmentApiClient(environmentId).listModels(modelCwd || undefined);
        if (signal?.aborted || !isCurrentConnection() || !modelListRequestGateRef.current.isCurrent(generation)) return;
        applyModelsResult(d);
      } catch (error) {
        if (signal?.aborted || !isCurrentConnection() || !modelListRequestGateRef.current.isCurrent(generation)) return;
        if (isRpcError(error) && (error.code === "CLOSED" || error.code === "DISCONNECTED")) {
          setModelReconnecting(true);
          setModelRefreshing(false);
          return;
        }
        setModelReconnecting(false);
        setModelLoadError(
          sessionClientErrorMessage(
            error,
            t,
            t(
              "modelDirectoryLoadFailed",
              "Unable to load the model directory. Retry from the model picker or check the Agent Host connection.",
            ),
          ),
        );
        throw error;
      } finally {
        if (!signal?.aborted && modelListRequestGateRef.current.isCurrent(generation)) setModelLoading(false);
      }
    },
    [
      applyModelsResult,
      locationKey,
      modelListSizeRef,
      setNewSessionDefaultModel,
      setModelLoadError,
      setModelLoading,
      setModelReconnecting,
      t,
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
    setModelLoading(false);
    if (isCurrentConnection())
      void getEnvironmentApiClient(environmentId)
        .cancelModelsRefresh(requestId)
        .catch(() => {});
  }, [
    environmentId,
    isCurrentConnection,
    modelListRequestGateRef,
    modelRefreshRequestRef,
    setModelRefreshing,
    setModelLoading,
  ]);

  const refreshModels = useCallback(async () => {
    if (!isCurrentConnection()) {
      setModelReconnecting(true);
      return;
    }
    const previousRequestId = modelRefreshRequestRef.current;
    if (previousRequestId)
      void getEnvironmentApiClient(environmentId)
        .cancelModelsRefresh(previousRequestId)
        .catch(() => {});
    const requestId = `models_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    const generation = modelListRequestGateRef.current.begin();
    modelRefreshRequestRef.current = requestId;
    setModelRefreshing(true);
    setModelLoading(false);
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
        !isCurrentConnection() ||
        modelRefreshRequestRef.current !== requestId ||
        !modelListRequestGateRef.current.isCurrent(generation)
      )
        return;
      if (isRpcError(error) && (error.code === "CLOSED" || error.code === "DISCONNECTED")) {
        setModelReconnecting(true);
        return;
      }
      setModelReconnecting(false);
      setModelLoadError(
        sessionClientErrorMessage(
          error,
          t,
          t("modelDirectoryRefreshFailed", "Unable to refresh the model directory. Cached models remain available."),
        ),
      );
      console.error("Failed to refresh model directory:", error);
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
    setModelLoading,
    setModelLoadError,
    setModelReconnecting,
    t,
  ]);
  return { loadModels, cancelModelRefresh, refreshModels };
}
export type SessionModels = ReturnType<typeof useSessionModels>;
