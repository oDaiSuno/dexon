import { qualifyProjectKey, type EnvironmentId } from "@contract/environment";
import { useEffect, useRef, useState } from "react";
import type { GitStatusResult } from "@shared/api-types";
import { getEnvironmentApiClient } from "@/lib/api-client";

export function useChangedPaths(
  environmentId: EnvironmentId,
  cwd: string | null,
  refreshKey: number,
): ReadonlySet<string> | null {
  const [result, setResult] = useState<{ key: string; paths: ReadonlySet<string> | null } | null>(null);
  const key = cwd ? qualifyProjectKey(environmentId, cwd) : null;
  const generation = useRef(0);

  useEffect(() => {
    const current = ++generation.current;
    if (!cwd || !key) {
      setResult(null);
      return;
    }
    void getEnvironmentApiClient(environmentId)
      .call("git.status", { path: cwd })
      .then((status: GitStatusResult) => {
        if (current !== generation.current) return;
        setResult({ key, paths: status.isGit ? new Set(status.entries.map((entry) => entry.path)) : null });
      })
      .catch(() => {
        if (current === generation.current) setResult(null);
      });
    return () => {
      generation.current += 1;
    };
  }, [environmentId, cwd, refreshKey, key]);

  return result?.key === key ? result.paths : null;
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
