import { useCallback, useEffect, useRef, useState } from "react";
import type { EnvironmentId } from "@contract/environment";
import type { RunDetailView, TaskRevisionView } from "@shared/automation/views";
import { useI18n } from "@/i18n";
import { useAutomationWorkspace } from "./automation-context";
import { isActivePhase } from "./automation-format";
import { errorMessage } from "./run-values";

interface RunData {
  readonly key: string;
  readonly run: RunDetailView | null;
  readonly revision: TaskRevisionView | null;
  readonly error: string | null;
  readonly revisionError: string | null;
  readonly loading: boolean;
}

export function useRunDetailData(environmentId: EnvironmentId, taskId: string, runId: string) {
  const { t } = useI18n();
  const { call, hosts, runs, inbox } = useAutomationWorkspace();
  const key = JSON.stringify([environmentId, taskId, runId]);
  const [data, setData] = useState<RunData | null>(null);
  const [reloadCount, setReloadCount] = useState(0);
  const revisionCache = useRef<{ key: string; value: TaskRevisionView } | null>(null);
  const lastReadAt = useRef(0);
  const online = hosts.some((host) => host.environment.id === environmentId && host.status === "online");
  const version = runs.find((entry) => entry.environmentId === environmentId && entry.run.id === runId)?.run.version;
  const inboxVersion = inbox
    .filter((entry) => entry.environmentId === environmentId && entry.item.runId === runId)
    .map((entry) => `${entry.item.kind}:${entry.item.stepIndex}:${entry.item.expectedVersion}`)
    .join("|");
  const reload = useCallback(() => setReloadCount((count) => count + 1), []);

  useEffect(() => {
    if (!online) return;
    let disposed = false;
    lastReadAt.current = Date.now();
    setData((previous) => ({
      key,
      run: previous?.key === key ? previous.run : null,
      revision: previous?.key === key ? previous.revision : null,
      error: null,
      revisionError: null,
      loading: true,
    }));
    const load = async () => {
      try {
        const { run } = await call(environmentId, "automation.getRun", { runId });
        if (disposed) return;
        if (run.taskId !== taskId)
          throw new Error(t("autoPageRunWrongTask", "This run does not belong to the selected task."));
        const revisionKey = JSON.stringify([environmentId, taskId, run.revision]);
        let revision = revisionCache.current?.key === revisionKey ? revisionCache.current.value : null;
        let revisionError: string | null = null;
        if (!revision) {
          try {
            const result = await call(environmentId, "automation.getTask", { taskId, revision: run.revision });
            if (disposed) return;
            revision = result.task;
            revisionCache.current = { key: revisionKey, value: revision };
          } catch (error) {
            revisionError = errorMessage(error);
          }
        }
        if (!disposed) setData({ key, run, revision, error: null, revisionError, loading: false });
      } catch (error) {
        if (!disposed) {
          setData((previous) => ({
            key,
            run: previous?.key === key ? previous.run : null,
            revision: previous?.key === key ? previous.revision : null,
            error: errorMessage(error),
            revisionError: previous?.key === key ? previous.revisionError : null,
            loading: false,
          }));
        }
      }
    };
    void load();
    return () => {
      disposed = true;
    };
  }, [call, environmentId, inboxVersion, key, online, reloadCount, runId, t, taskId, version]);

  const current = data?.key === key ? data : null;
  const phase = current?.run?.phase;
  const loading = online && (current?.loading ?? true);
  useEffect(() => {
    if (!online || loading || !phase || !isActivePhase(phase)) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && Date.now() - lastReadAt.current >= 10_000) reload();
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [loading, online, phase, reload]);

  return {
    run: current?.run ?? null,
    revision: current?.revision ?? null,
    error: current?.error ?? null,
    revisionError: current?.revisionError ?? null,
    loading,
    online,
    reload,
  };
}
