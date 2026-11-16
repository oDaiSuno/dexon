import { useEffect, useState } from "react";
import type { EnvironmentId } from "@contract/environment";
import { getEnvironmentApiClient } from "@/lib/api-client";
import { useEnvironments } from "@/lib/environment-registry";
import { worktreePathsEqual } from "@shared/worktree-path";

export type SessionLocation =
  { status: "ready"; branch: string | null; isWorktree: boolean } | { status: "unavailable" };

export function useSessionLocation(environmentId: EnvironmentId, cwd: string | null): SessionLocation | null {
  const environment = useEnvironments().find((view) => view.id === environmentId);
  const generation = environment?.status.phase === "connected" ? environment.status.generation : null;
  const key = JSON.stringify([environmentId, generation, cwd]);
  const [location, setLocation] = useState<{ key: string; value: SessionLocation } | null>(null);
  useEffect(() => {
    if (!cwd) return;
    let cancelled = false;
    const api = getEnvironmentApiClient(environmentId);
    void Promise.all([api.call("git.branch", { path: cwd }), api.listWorktrees(cwd)]).then(
      ([branchResult, listResult]) => {
        if (cancelled) return;
        setLocation({
          key,
          value: {
            status: "ready",
            branch: branchResult.branch ?? null,
            isWorktree: listResult.worktrees.some(
              (entry) => worktreePathsEqual(entry.path, cwd) && entry.isMain !== true,
            ),
          },
        });
      },
      () => {
        if (!cancelled) setLocation({ key, value: { status: "unavailable" } });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [cwd, environmentId, key]);
  return location?.key === key ? location.value : null;
}
