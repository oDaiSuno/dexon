import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import { PRIMARY_ENVIRONMENT_ID, type EnvironmentView } from "@contract/environment";
import { useActiveEnvironment, useEnvironments } from "@/lib/environment-registry";
import { NO_SESSION_ACTIVITY } from "@/lib/session-tree-status";
import { createEnvironmentDirectory, type EnvironmentDirectoryState } from "./environment-directory";

export interface EnvironmentDirectory extends EnvironmentDirectoryState {
  environment: EnvironmentView;
  refreshSessions: (showLoading?: boolean) => Promise<void>;
}

type DirectoryController = ReturnType<typeof createEnvironmentDirectory>;

export function useEnvironmentDirectories({
  selectedSessionId,
  refreshKey = 0,
  onSessionDeleted,
}: {
  selectedSessionId: string | null;
  refreshKey?: number;
  onSessionDeleted?: (sessionId: string, environmentId: string) => void;
}): EnvironmentDirectory[] {
  const { t } = useI18n();
  const environments = useEnvironments();
  const activeEnvironment = useActiveEnvironment();
  const controllers = useRef(
    new Map<string, { directory: DirectoryController; generation: number | null; refreshKey: number }>(),
  );
  const onDeleted = useRef(onSessionDeleted);
  onDeleted.current = onSessionDeleted;
  const [states, setStates] = useState<Record<string, EnvironmentDirectoryState>>({});

  useEffect(() => {
    const ids = new Set(environments.map((view) => view.id));
    for (const [id, entry] of controllers.current) {
      if (ids.has(id)) continue;
      entry.directory.dispose();
      controllers.current.delete(id);
      setStates((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)));
    }
    for (const view of environments) {
      const generation = view.status.phase === "connected" ? view.status.generation : null;
      const existing = controllers.current.get(view.id);
      if (existing) {
        if (generation !== null && generation !== existing.generation) existing.directory.restart();
        else if (existing.refreshKey !== refreshKey) void existing.directory.refresh();
        existing.generation = generation;
        existing.refreshKey = refreshKey;
        existing.directory.select(activeEnvironment.id === view.id ? selectedSessionId : null);
        continue;
      }
      if (view.id !== PRIMARY_ENVIRONMENT_ID && view.status.phase !== "connected") continue;
      const directory = createEnvironmentDirectory(
        view.id,
        (state) => setStates((current) => ({ ...current, [view.id]: state })),
        (id) => onDeleted.current?.(id, view.id),
      );
      controllers.current.set(view.id, { directory, generation, refreshKey });
      directory.select(activeEnvironment.id === view.id ? selectedSessionId : null);
    }
  }, [environments, activeEnvironment.id, selectedSessionId, refreshKey]);

  useEffect(() => {
    const current = controllers.current;
    return () => {
      for (const entry of current.values()) entry.directory.dispose();
      current.clear();
    };
  }, []);

  return environments.map((environment) => {
    const state = states[environment.id];
    return {
      environment,
      sessions: state?.sessions ?? [],
      runningSessionIds: state?.runningSessionIds ?? new Set<string>(),
      liveStatuses: state?.liveStatuses ?? {},
      unreadSessionIds: state?.unreadSessionIds ?? new Set<string>(),
      activity: state?.activity ?? NO_SESSION_ACTIVITY,
      loading:
        state?.loading ??
        (environment.id === PRIMARY_ENVIRONMENT_ID ||
          (environment.enabled && ["connected", "connecting", "backoff"].includes(environment.status.phase))),
      error:
        state?.error === "UNAUTHORIZED"
          ? t(
              "sessionLoadUnauthorized",
              "Unauthorized (401). Restart Pi Desktop so the renderer can reconnect to the Agent Host.",
            )
          : state?.error
            ? t("sessionLoadFailedStatus", "Failed to load sessions ({status})").replace("{status}", state.error)
            : null,
      sessionRefreshDone: state?.sessionRefreshDone ?? false,
      refreshSessions: (showLoading = false) =>
        controllers.current.get(environment.id)?.directory.refresh(showLoading) ?? Promise.resolve(),
    };
  });
}
