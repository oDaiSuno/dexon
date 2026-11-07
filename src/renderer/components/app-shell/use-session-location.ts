import { useEffect, useState } from "react";
import { getEnvironmentApiClient } from "@/lib/api-client";
import { useActiveEnvironment } from "@/lib/environment-registry";
import { worktreePathsEqual } from "@shared/worktree-path";

export interface SessionLocation {
  branch: string | null;
  isWorktree: boolean;
}

export function useSessionLocation(cwd: string | null): SessionLocation | null {
  const environment = useActiveEnvironment();
  const generation = environment.status.phase === "connected" ? environment.status.generation : null;
  const key = JSON.stringify([environment.id, generation, cwd]);
  const [location, setLocation] = useState<{ key: string; value: SessionLocation } | null>(null);
  useEffect(() => {
    if (!cwd) return;
    let cancelled = false;
    const api = getEnvironmentApiClient(environment.id);
    void Promise.all([
      api.call("git.branch", { path: cwd }).catch(() => ({ isGit: false, branch: null })),
      api.listWorktrees(cwd).catch(() => ({ worktrees: [] })),
    ]).then(([branchResult, listResult]) => {
      if (cancelled) return;
      setLocation({
        key,
        value: {
          branch: branchResult.branch ?? null,
          isWorktree: listResult.worktrees.some(
            (entry) => worktreePathsEqual(entry.path, cwd) && entry.isMain !== true,
          ),
        },
      });
    });
    return () => {
      cancelled = true;
    };
  }, [cwd, environment.id, key]);
  return location?.key === key ? location.value : null;
}
