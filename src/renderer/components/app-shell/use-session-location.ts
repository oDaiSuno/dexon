import { useEffect, useState } from "react";
import { call } from "@/lib/api-client";
import { worktreePathsEqual } from "@shared/worktree-path";

export interface SessionLocation {
  branch: string | null;
  isWorktree: boolean;
}

export function useSessionLocation(cwd: string | null): SessionLocation | null {
  const [location, setLocation] = useState<SessionLocation | null>(null);

  useEffect(() => {
    if (!cwd) {
      setLocation(null);
      return;
    }
    let cancelled = false;
    setLocation((prev) => prev ?? { branch: null, isWorktree: false });
    void Promise.all([
      call("git.branch", { path: cwd }).catch(() => ({ isGit: false, branch: null })),
      call("worktrees.list", { projectRoot: cwd }).catch(() => ({ worktrees: [] })),
    ]).then(
      ([branchResult, listResult]) => {
        if (cancelled) return;
        const worktrees = (listResult as { worktrees?: { path: string; isMain?: boolean }[] }).worktrees ?? [];
        setLocation({
          branch: branchResult.branch ?? null,
          isWorktree: worktrees.some((entry) => worktreePathsEqual(entry.path, cwd) && entry.isMain !== true),
        });
      },
      () => {
        if (!cancelled) setLocation({ branch: null, isWorktree: false });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [cwd]);

  return location;
}
