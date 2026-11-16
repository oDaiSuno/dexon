import { qualifyProjectKey, type EnvironmentId } from "@contract/environment";
import { useEffect, useState } from "react";
import { getEnvironmentApiClient } from "@/lib/api-client";
import { useEnvironments } from "@/lib/environment-registry";

export type ChangedPathsState =
  { status: "unavailable"; changedPaths: null } | { status: "ready"; changedPaths: ReadonlySet<string> | null };

export function useChangedPaths(
  environmentId: EnvironmentId,
  cwd: string | null,
  refreshKey: number,
): ChangedPathsState {
  const environment = useEnvironments().find((view) => view.id === environmentId);
  const generation = environment?.status.phase === "connected" ? environment.status.generation : null;
  const key = JSON.stringify([cwd ? qualifyProjectKey(environmentId, cwd) : null, generation, refreshKey]);
  const [result, setResult] = useState<{ key: string; value: ChangedPathsState } | null>(null);

  useEffect(() => {
    if (!cwd) return;
    let cancelled = false;
    void getEnvironmentApiClient(environmentId)
      .call("git.status", { path: cwd })
      .then(
        (status) => {
          if (cancelled) return;
          setResult({
            key,
            value: {
              status: "ready",
              changedPaths: status.isGit ? new Set(status.entries.map((entry) => entry.path)) : null,
            },
          });
        },
        () => {
          if (!cancelled) setResult({ key, value: { status: "unavailable", changedPaths: null } });
        },
      );
    return () => {
      cancelled = true;
    };
  }, [environmentId, cwd, key]);

  return result?.key === key ? result.value : { status: "unavailable", changedPaths: null };
}

export function isPathChanged(changed: ReadonlySet<string> | null, relativePath: string): boolean {
  if (!changed || changed.size === 0) return false;
  if (changed.has(relativePath)) return true;
  const segments = relativePath.split("/");
  for (let index = 1; index < segments.length; index++) {
    if (changed.has(`${segments.slice(0, index).join("/")}/`)) return true;
  }
  return false;
}
