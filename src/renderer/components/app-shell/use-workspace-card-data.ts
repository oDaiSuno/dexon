import { useCallback, useEffect, useRef, useState } from "react";
import type { EnvironmentId, EnvironmentView } from "@contract/environment";
import type { WorktreeBranchesResult } from "@shared/api-types";
import type { MountedSpace } from "@/lib/workspace-store";
import { getEnvironmentApiClient } from "@/lib/api-client";

interface Listing {
  result: WorktreeBranchesResult | null;
  loading: boolean;
  refreshQueued: boolean;
  error?: string;
}

interface FactJob {
  environmentId: EnvironmentId;
  generation: number;
  path: string;
  key: string;
}

interface ProjectFacts {
  isGit: boolean;
  branch: string | null;
}

export function useWorkspaceCardData({
  activeEnvironmentId,
  browsedEnvironmentId,
  folder,
  spaces,
  environments,
  open,
  refreshKey,
  refreshToken,
  isMissing,
}: {
  activeEnvironmentId: EnvironmentId;
  browsedEnvironmentId: EnvironmentId;
  folder: string | null;
  spaces: readonly MountedSpace[] | null;
  environments: readonly EnvironmentView[];
  open: boolean;
  refreshKey: number;
  refreshToken: number;
  isMissing: (folder: string | null | undefined, environmentId?: EnvironmentId) => boolean;
}) {
  const environment = environments.find((view) => view.id === browsedEnvironmentId);
  const generation = environment?.status.phase === "connected" ? environment.status.generation : null;
  const [, setCacheVersion] = useState(0);
  const listings = useRef(new Map<string, Listing>());
  const facts = useRef(new Map<string, ProjectFacts>());
  const authorizations = useRef(new Map<string, Promise<void>>());
  const factQueues = useRef(new Map<EnvironmentId, FactJob[]>());
  const runningFacts = useRef(new Map<EnvironmentId, Set<string>>());
  const mounted = useRef(true);
  const latest = useRef({ environments, open });
  latest.current = { environments, open };

  const notifyCache = useCallback(() => {
    if (mounted.current) setCacheVersion((version) => version + 1);
  }, []);

  const isCurrentConnection = useCallback((targetEnvironmentId: EnvironmentId, targetGeneration: number) => {
    const view = latest.current.environments.find((view) => view.id === targetEnvironmentId);
    return mounted.current && view?.status.phase === "connected" && view.status.generation === targetGeneration;
  }, []);

  const authorize = useCallback(
    (targetEnvironmentId: EnvironmentId, targetGeneration: number, path: string) => {
      const key = JSON.stringify([targetEnvironmentId, targetGeneration, path]);
      const cached = authorizations.current.get(key);
      if (cached) return cached;
      const authorization = getEnvironmentApiClient(targetEnvironmentId)
        .validateCwd(path)
        .then((result) => {
          if (!isCurrentConnection(targetEnvironmentId, targetGeneration)) throw new Error("Connection changed");
          if (!result.ok) throw new Error(result.error ?? "Folder is unavailable");
        });
      authorizations.current.set(key, authorization);
      void authorization.catch(() => {
        if (authorizations.current.get(key) === authorization) authorizations.current.delete(key);
      });
      return authorization;
    },
    [isCurrentConnection],
  );

  const loadBranches = useCallback(
    function load(path: string, requiredRefresh = true) {
      if (generation === null || !isCurrentConnection(browsedEnvironmentId, generation)) return;
      const key = JSON.stringify([browsedEnvironmentId, generation, path]);
      const cached = listings.current.get(key);
      if (cached?.loading) {
        if (requiredRefresh) cached.refreshQueued = true;
        return;
      }
      const entry: Listing = { result: cached?.result ?? null, loading: true, refreshQueued: false };
      listings.current.set(key, entry);
      notifyCache();
      void authorize(browsedEnvironmentId, generation, path)
        .then(() => {
          if (!isCurrentConnection(browsedEnvironmentId, generation)) throw new Error("Connection changed");
          return getEnvironmentApiClient(browsedEnvironmentId).call("worktrees.branches", { cwd: path });
        })
        .then(
          (result) => {
            if (
              entry.refreshQueued ||
              listings.current.get(key) !== entry ||
              !isCurrentConnection(browsedEnvironmentId, generation)
            )
              return;
            entry.result = result;
          },
          (error: unknown) => {
            if (
              entry.refreshQueued ||
              listings.current.get(key) !== entry ||
              !isCurrentConnection(browsedEnvironmentId, generation)
            )
              return;
            entry.error = error instanceof Error ? error.message : String(error);
          },
        )
        .finally(() => {
          entry.loading = false;
          if (listings.current.get(key) !== entry) return;
          if (entry.refreshQueued) load(path, false);
          else notifyCache();
        });
    },
    [authorize, browsedEnvironmentId, generation, isCurrentConnection, notifyCache],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const connectionsKey = JSON.stringify(
    environments.map((view) => [view.id, view.status.phase === "connected" ? view.status.generation : null]),
  );
  useEffect(() => {
    for (const cache of [listings.current, authorizations.current, facts.current]) {
      for (const key of cache.keys()) {
        const [id, cachedGeneration] = JSON.parse(key) as [EnvironmentId, number];
        const view = latest.current.environments.find((view) => view.id === id);
        if (!view || (view.status.phase === "connected" && view.status.generation !== cachedGeneration))
          cache.delete(key);
      }
    }
  }, [connectionsKey]);

  const previousRefreshKey = useRef(refreshKey);
  useEffect(() => {
    const requiredRefresh = previousRefreshKey.current !== refreshKey;
    previousRefreshKey.current = refreshKey;
    if (!open || !folder || spaces === null || isMissing(folder, browsedEnvironmentId)) return;
    loadBranches(folder, requiredRefresh);
  }, [open, folder, refreshToken, refreshKey, loadBranches, spaces, isMissing, browsedEnvironmentId]);

  const pumpFacts = useCallback(
    function pump(targetEnvironmentId: EnvironmentId) {
      let running = runningFacts.current.get(targetEnvironmentId);
      if (!running) {
        running = new Set();
        runningFacts.current.set(targetEnvironmentId, running);
      }
      const queue = factQueues.current.get(targetEnvironmentId);
      while (latest.current.open && queue?.length && running.size < 3) {
        const job = queue.shift();
        if (!job) break;
        if (!isCurrentConnection(job.environmentId, job.generation) || running.has(job.key)) continue;
        running.add(job.key);
        void authorize(job.environmentId, job.generation, job.path)
          .then(() => {
            if (!isCurrentConnection(job.environmentId, job.generation)) throw new Error("Connection changed");
            return getEnvironmentApiClient(job.environmentId).call("git.branch", { path: job.path });
          })
          .then(
            (result) => {
              if (!isCurrentConnection(job.environmentId, job.generation)) return;
              facts.current.set(job.key, { isGit: result.isGit, branch: result.branch ?? null });
              notifyCache();
            },
            () => {},
          )
          .finally(() => {
            running.delete(job.key);
            pump(targetEnvironmentId);
          });
      }
    },
    [authorize, isCurrentConnection, notifyCache],
  );

  useEffect(() => {
    factQueues.current.clear();
    if (!open || spaces === null) return;
    const views = [...latest.current.environments].sort(
      (left, right) => Number(right.id === activeEnvironmentId) - Number(left.id === activeEnvironmentId),
    );
    for (const view of views) {
      if (view.status.phase !== "connected") continue;
      const targetGeneration = view.status.generation;
      const jobs = spaces
        .filter((space) => space.environmentId === view.id && !isMissing(space.path, space.environmentId))
        .map((space) => ({
          environmentId: space.environmentId,
          generation: targetGeneration,
          path: space.path,
          key: JSON.stringify([space.environmentId, targetGeneration, space.path]),
        }))
        .filter((job) => !runningFacts.current.get(view.id)?.has(job.key));
      factQueues.current.set(view.id, jobs);
      pumpFacts(view.id);
    }
  }, [open, spaces, isMissing, activeEnvironmentId, connectionsKey, refreshKey, pumpFacts]);

  const authorizeFolder = useCallback(
    (path: string) => {
      if (generation === null) return Promise.reject(new Error("Environment is not connected"));
      return authorize(browsedEnvironmentId, generation, path);
    },
    [authorize, browsedEnvironmentId, generation],
  );

  return {
    listing:
      folder && generation !== null
        ? listings.current.get(JSON.stringify([browsedEnvironmentId, generation, folder]))
        : undefined,
    factsFor: (targetEnvironmentId: EnvironmentId, path: string) => {
      const view = environments.find((view) => view.id === targetEnvironmentId);
      return view?.status.phase === "connected"
        ? facts.current.get(JSON.stringify([targetEnvironmentId, view.status.generation, path]))
        : undefined;
    },
    authorize: authorizeFolder,
    loadBranches,
  };
}
