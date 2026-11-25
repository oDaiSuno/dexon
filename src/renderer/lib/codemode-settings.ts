import { useCallback, useEffect, useRef, useState } from "react";
import type { EnvironmentId } from "@contract/environment";
import { isRpcError } from "@contract/types";
import type { CodemodeMode, CodemodeSettingsPatch, CodemodeSettingsResult } from "@shared/codemode";
import { getEnvironmentApiClient } from "./api-client";

type CodemodeSettingsLoadState =
  | { status: "ready"; settings: CodemodeSettingsResult }
  | { status: "unsupported" }
  | { status: "error"; message: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface CacheEntry {
  state?: CodemodeSettingsLoadState;
  pending?: Promise<CodemodeSettingsLoadState>;
}

const settingsCache = new Map<EnvironmentId, Map<string, CacheEntry>>();

export function resetCodemodeSettingsCache(): void {
  settingsCache.clear();
}

export function loadCodemodeSettings(environmentId: EnvironmentId, cwd?: string): Promise<CodemodeSettingsLoadState> {
  const key = cwd || "";
  let environment = settingsCache.get(environmentId);
  if (!environment) {
    environment = new Map();
    settingsCache.set(environmentId, environment);
  }
  const cached = environment.get(key);
  if (cached?.pending) return cached.pending;
  if (cached?.state) return Promise.resolve(cached.state);
  const entry: CacheEntry = {};
  environment.set(key, entry);
  const request = readCodemodeSettings(environmentId, cwd).then((state) => {
    if (settingsCache.get(environmentId)?.get(key) === entry) {
      entry.pending = undefined;
      if (state.status !== "error") entry.state = state;
    }
    return state;
  });
  entry.pending = request;
  return request;
}

export async function saveCodemodeSettings(
  environmentId: EnvironmentId,
  patch: CodemodeSettingsPatch,
): Promise<CodemodeSettingsResult> {
  settingsCache.delete(environmentId);
  try {
    return await getEnvironmentApiClient(environmentId).call("codemode.set", patch);
  } finally {
    settingsCache.delete(environmentId);
  }
}

interface Scope {
  environmentId: EnvironmentId;
  cwd?: string;
}

interface SaveRequest {
  scope: Scope;
  promise: Promise<void>;
}

interface SettingsView {
  state: "loading" | "ready" | "unsupported" | "error";
  settings: CodemodeSettingsResult | null;
  errorMessage: string | null;
}

const loadingView: SettingsView = { state: "loading", settings: null, errorMessage: null };

export function useCodemodeSettings(environmentId: EnvironmentId, cwd?: string) {
  const requestedCwd = cwd || undefined;
  const scopeRef = useRef<Scope | null>(null);
  if (!scopeRef.current || scopeRef.current.environmentId !== environmentId || scopeRef.current.cwd !== requestedCwd) {
    scopeRef.current = { environmentId, cwd: requestedCwd };
  }
  const scope = scopeRef.current;
  const currentScopeRef = useRef<Scope | null>(null);
  currentScopeRef.current = scope;
  const [snapshot, setSnapshot] = useState(() => ({ scope, ...loadingView }));
  const [savingState, setSavingState] = useState<{ scope: Scope; active: boolean } | null>(null);
  const requestSequence = useRef(0);
  const savingRequests = useRef(new Map<EnvironmentId, SaveRequest>());
  const matches = snapshot.scope === scope;

  const reload = useCallback(async (): Promise<void> => {
    if (currentScopeRef.current !== scope) return;
    const sequence = ++requestSequence.current;
    const request = savingRequests.current.get(scope.environmentId);
    if (request) await request.promise;
    if (currentScopeRef.current !== scope || requestSequence.current !== sequence) return;
    settingsCache.get(scope.environmentId)?.delete(scope.cwd || "");
    setSnapshot({ scope, ...loadingView });
    const result = await loadCodemodeSettings(scope.environmentId, scope.cwd);
    if (currentScopeRef.current !== scope || requestSequence.current !== sequence) return;
    setSnapshot({
      scope,
      state: result.status,
      settings: result.status === "ready" ? result.settings : null,
      errorMessage: result.status === "error" ? result.message : null,
    });
  }, [scope]);

  useEffect(() => {
    currentScopeRef.current = scope;
    void reload();
    return () => {
      if (currentScopeRef.current === scope) currentScopeRef.current = null;
      requestSequence.current += 1;
      settingsCache.get(scope.environmentId)?.delete(scope.cwd || "");
    };
  }, [scope, reload]);

  const dismissError = useCallback((): void => {
    if (currentScopeRef.current !== scope) return;
    setSnapshot((previous) => (previous.scope === scope ? { ...previous, errorMessage: null } : previous));
  }, [scope]);

  const save = useCallback(
    (patch: Pick<CodemodeSettingsPatch, "enabled" | "mode">): Promise<void> => {
      const before = snapshot.settings;
      const request = savingRequests.current.get(scope.environmentId);
      if (
        currentScopeRef.current !== scope ||
        snapshot.scope !== scope ||
        snapshot.state !== "ready" ||
        !before ||
        before.availability.available === false ||
        request
      )
        return Promise.resolve();
      if (
        (patch.enabled === undefined || patch.enabled === before.enabled) &&
        (patch.mode === undefined || patch.mode === before.mode)
      )
        return Promise.resolve();
      requestSequence.current += 1;
      setSavingState({ scope, active: true });
      setSnapshot((previous) => ({
        ...previous,
        state: "ready",
        settings: { ...before, ...patch },
        errorMessage: null,
      }));
      const requestState = { scope, promise: Promise.resolve() } as SaveRequest;
      const operation = (async () => {
        try {
          const settings = await saveCodemodeSettings(scope.environmentId, {
            ...patch,
            ...(scope.cwd ? { cwd: scope.cwd } : {}),
          });
          if (currentScopeRef.current === scope)
            setSnapshot((previous) =>
              previous.scope === scope ? { ...previous, settings, errorMessage: null } : previous,
            );
        } catch (error) {
          if (currentScopeRef.current === scope)
            setSnapshot((previous) =>
              previous.scope === scope
                ? {
                    ...previous,
                    settings: before,
                    errorMessage: errorMessage(error),
                  }
                : previous,
            );
        } finally {
          if (savingRequests.current.get(scope.environmentId) === requestState)
            savingRequests.current.delete(scope.environmentId);
          if (currentScopeRef.current === scope)
            setSavingState((previous) => (previous?.scope === scope ? { scope, active: false } : previous));
        }
      })();
      requestState.promise = operation;
      savingRequests.current.set(scope.environmentId, requestState);
      return operation;
    },
    [scope, snapshot.settings, snapshot.scope, snapshot.state],
  );

  const toggleEnabled = useCallback((nextEnabled: boolean): Promise<void> => save({ enabled: nextEnabled }), [save]);
  const setMode = useCallback((mode: CodemodeMode): Promise<void> => save({ mode }), [save]);

  const view = matches ? snapshot : loadingView;
  const saving = savingState?.scope === scope && savingState.active;
  return {
    state: view.state,
    settings: view.settings,
    saving,
    errorMessage: view.errorMessage,
    toggleEnabled,
    setMode,
    reload,
    dismissError,
  };
}

export type CodemodeSettingsController = ReturnType<typeof useCodemodeSettings>;

async function readCodemodeSettings(environmentId: EnvironmentId, cwd?: string): Promise<CodemodeSettingsLoadState> {
  try {
    const settings = await getEnvironmentApiClient(environmentId).call("codemode.get", cwd ? { cwd } : undefined);
    return { status: "ready", settings };
  } catch (error) {
    if (isRpcError(error) && error.code === "METHOD_NOT_FOUND") return { status: "unsupported" };
    return { status: "error", message: errorMessage(error) };
  }
}
