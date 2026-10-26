import { useEffect, useRef, useState } from "react";
import type { GitStatusResult } from "@shared/api-types";
import { call } from "@/lib/api-client";

export function useChangedPaths(cwd: string | null, refreshKey: number): ReadonlySet<string> | null {
  const [paths, setPaths] = useState<ReadonlySet<string> | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    const current = ++generation.current;
    if (!cwd) {
      setPaths(null);
      return;
    }
    void call("git.status", { path: cwd })
      .then((status: GitStatusResult) => {
        if (current !== generation.current) return;
        setPaths(status.isGit ? new Set(status.entries.map((entry) => entry.path)) : null);
      })
      .catch(() => {
        if (current === generation.current) setPaths(null);
      });
  }, [cwd, refreshKey]);

  return paths;
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
