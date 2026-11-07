import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { EnvironmentCommand, EnvironmentCommandResult } from "@contract/environment-commands";
import type { EnvironmentId } from "@contract/environment";
import { getEnvironmentConnection, runEnvironmentCommand, useEnvironmentsSnapshot } from "@/lib/environment-registry";
import { workspaceStore } from "@/lib/workspace-store";

export type ServerActionResult<C extends EnvironmentCommand> =
  { ok: true; value: EnvironmentCommandResult<C> } | { ok: false };

export function useServerActions() {
  const [pending, setPending] = useState<EnvironmentCommand["type"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(false);
  const busy = useRef<number | null>(null);
  const revision = useRef(0);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      busy.current = null;
      revision.current += 1;
    };
  }, []);

  const run = useCallback(async <C extends EnvironmentCommand>(command: C): Promise<ServerActionResult<C>> => {
    if (!active.current || busy.current !== null) return { ok: false };
    const request = ++revision.current;
    busy.current = request;
    setPending(command.type);
    setError(null);
    try {
      const value = await runEnvironmentCommand(command);
      return active.current && request === revision.current ? { ok: true, value } : { ok: false };
    } catch (failure) {
      if (active.current && request === revision.current) {
        setError(failure instanceof Error ? failure.message : String(failure));
      }
      return { ok: false };
    } finally {
      if (busy.current === request) busy.current = null;
      if (active.current && request === revision.current) setPending(null);
    }
  }, []);

  return { run, pending, error };
}

export function useServerRemovalImpact(environmentId: EnvironmentId) {
  const workspace = useSyncExternalStore(
    workspaceStore.subscribe,
    workspaceStore.getSnapshot,
    workspaceStore.getSnapshot,
  );
  const { environments } = useEnvironmentsSnapshot();
  const view = environments.find((environment) => environment.id === environmentId);
  const generation = view?.status.phase === "connected" ? view.status.generation : null;
  const [sessions, setSessions] = useState<{ environmentId: string; generation: number; count: number } | null>(null);

  useEffect(() => {
    if (generation === null) return;
    let active = true;
    let revision = 0;
    const connection = getEnvironmentConnection(environmentId);
    const refresh = async () => {
      const request = ++revision;
      try {
        const listing = await connection.call("sessions.list");
        if (active && request === revision) {
          setSessions({ environmentId, generation, count: new Set(listing.runningSessionIds).size });
        }
      } catch {
        if (active && request === revision) setSessions(null);
      }
    };
    void refresh();
    const subscriptions: (() => void)[] = [];
    for (const topic of ["agent.running", "sessions.changed"] as const) {
      void connection
        .subscribe(topic, "*", () => void refresh())
        .then((off) => {
          if (active) subscriptions.push(off);
          else off();
        })
        .catch(() => {});
    }
    return () => {
      active = false;
      subscriptions.forEach((off) => off());
    };
  }, [environmentId, generation]);

  return {
    mountedSpaces: workspace.loaded
      ? workspace.spaces.filter((space) => space.environmentId === environmentId).length
      : null,
    spaces: workspace.spaces.filter((space) => space.environmentId === environmentId),
    runningSessions:
      generation !== null && sessions?.environmentId === environmentId && sessions.generation === generation
        ? sessions.count
        : null,
  };
}
