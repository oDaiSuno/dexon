import { useEffect, useMemo, useState } from "react";
import type { TaskRevisionView, TaskView } from "@shared/automation/views";
import { useAutomationWorkspace, type HostedRun, type HostedTask } from "./automation-context";

export function taskError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface TaskLoad {
  key: string;
  entry: HostedTask | null;
  error: string | null;
  loading: boolean;
}

export function useTaskEntry(environmentId: string, taskId: string) {
  const { tasks, hosts, loading: workspaceLoading, call } = useAutomationWorkspace();
  const live = tasks.find((entry) => entry.environmentId === environmentId && entry.task.id === taskId);
  const host = hosts.find((entry) => entry.environment.id === environmentId);
  const online = host?.status === "online";
  const key = JSON.stringify([environmentId, taskId]);
  const [loaded, setLoaded] = useState<TaskLoad | null>(null);
  const [retry, setRetry] = useState(0);
  const task = live?.task;
  const revision = live?.revision;
  const currentRevision = task?.currentRevision;
  const enabledRevision = task?.enabledRevision;
  const updatedAtMs = task?.updatedAtMs;
  const revisionReady = revision?.revision === currentRevision && revision != null;
  const waiting = workspaceLoading || host?.loading === true;

  useEffect(() => {
    if (revisionReady || !online || waiting) return;
    let active = true;
    setLoaded({ key, entry: null, error: null, loading: true });
    const load = async () => {
      let found: TaskView | undefined = task;
      if (!found) {
        const result = await call(environmentId, "automation.listTasks");
        found = result.tasks.find((candidate) => candidate.id === taskId);
      }
      let source: TaskRevisionView | null = null;
      if (found) {
        const result = await call(environmentId, "automation.getTask", {
          taskId,
          revision: found.currentRevision,
        });
        source = result.task;
      }
      if (active) {
        setLoaded({
          key,
          entry: found ? { environmentId, task: found, revision: source, latestRun: null } : null,
          error: null,
          loading: false,
        });
      }
    };
    void load().catch((error: unknown) => {
      if (active) setLoaded({ key, entry: null, error: taskError(error), loading: false });
    });
    return () => {
      active = false;
    };
  }, [
    call,
    environmentId,
    taskId,
    key,
    online,
    waiting,
    currentRevision,
    enabledRevision,
    updatedAtMs,
    revisionReady,
    task,
    retry,
  ]);

  const fallback = loaded?.key === key ? loaded : null;
  const matchingSource = fallback?.entry?.revision;
  const entry: HostedTask | null = live
    ? {
        ...live,
        revision: revisionReady
          ? (revision ?? null)
          : matchingSource && matchingSource.revision === currentRevision
            ? matchingSource
            : null,
      }
    : (fallback?.entry ?? null);
  return {
    entry,
    online,
    host,
    error: fallback?.error ?? null,
    loading: !entry && (waiting || (online && (!fallback || fallback.loading))),
    revisionLoading: Boolean(entry && !entry.revision && online && (!fallback || fallback.loading)),
    reload: () => setRetry((value) => value + 1),
  };
}

export function useTaskRuns(environmentId: string, taskId: string, online: boolean) {
  const { runs, call } = useAutomationWorkspace();
  const key = JSON.stringify([environmentId, taskId]);
  const [loaded, setLoaded] = useState<{ key: string; runs: readonly HostedRun[]; error: string | null } | null>(null);
  useEffect(() => {
    if (!online) return;
    let active = true;
    void call(environmentId, "automation.listRuns", { taskId, limit: 100 }).then(
      (result) => {
        if (active) {
          setLoaded({
            key,
            runs: result.runs.map((run) => ({ environmentId, run })),
            error: null,
          });
        }
      },
      (error: unknown) => {
        if (active) setLoaded({ key, runs: [], error: taskError(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [call, environmentId, taskId, key, online]);
  const matching = loaded?.key === key ? loaded : null;
  const merged = useMemo(() => {
    const entries = new Map<string, HostedRun>();
    for (const entry of [...(matching?.runs ?? []), ...runs]) {
      if (entry.environmentId !== environmentId || entry.run.taskId !== taskId) continue;
      const previous = entries.get(entry.run.id);
      if (!previous || entry.run.updatedAtMs >= previous.run.updatedAtMs) entries.set(entry.run.id, entry);
    }
    return [...entries.values()].sort((left, right) => right.run.createdAtMs - left.run.createdAtMs);
  }, [matching, runs, environmentId, taskId]);
  return { runs: merged, error: matching?.error ?? null, loading: online && !matching && merged.length === 0 };
}
