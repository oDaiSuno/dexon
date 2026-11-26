import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { translate as t } from "@/i18n";
import type { ApiMethod, ApiParams, ApiResult } from "@contract/api";
import type { AutomationCommand, AutomationCommandResult } from "@contract/automation-commands";
import { PRIMARY_ENVIRONMENT_ID, type EnvironmentId, type EnvironmentView } from "@contract/environment";
import { getEnvironmentConnection, runEnvironmentCommand, useEnvironmentsSnapshot } from "@/lib/environment-registry";
import type { AutomationHost, HostedInbox, HostedRun, HostedTask, HostStatus } from "./automation-context";

interface HostData {
  tasks: readonly HostedTask[];
  inbox: readonly HostedInbox[];
  runs: readonly HostedRun[];
  error: string | null;
  loading: boolean;
}
const emptyHostData: HostData = { tasks: [], inbox: [], runs: [], error: null, loading: true };
export function hostStatus(environment: EnvironmentView): HostStatus {
  const phase = environment.status.phase;
  if (phase === "connected" || (environment.id === PRIMARY_ENVIRONMENT_ID && phase === "available")) return "online";
  return phase === "available" ? "offline" : phase;
}
export function automationCall<M extends ApiMethod>(
  environmentId: EnvironmentId,
  method: M,
  params?: ApiParams<M>,
): Promise<ApiResult<M>> {
  return getEnvironmentConnection(environmentId).call(method, ...([params] as never));
}
export function useAutomationStore() {
  const { environments } = useEnvironmentsSnapshot();
  const [data, setData] = useState<Record<string, HostData>>({});
  const [nativeConsentPending, setNativeConsentPending] = useState<{ label: string } | null>(null);
  const environmentsRef = useRef(environments);
  environmentsRef.current = environments;
  const generation = useRef(0);
  const consentPending = useRef(false);
  const refreshers = useRef(new Map<string, () => Promise<void>>());
  const connectedKey = JSON.stringify(
    environments.map((environment) => ({ id: environment.id, status: environment.status })),
  );

  useEffect(() => {
    const epoch = ++generation.current;
    let disposed = false;
    const unsubscribes: (() => void)[] = [];
    const ids = new Set(environmentsRef.current.map((host) => host.id));
    setData((previous) => Object.fromEntries(Object.entries(previous).filter(([id]) => ids.has(id))));
    refreshers.current.clear();
    for (const environment of environmentsRef.current) {
      if (hostStatus(environment) !== "online") continue;
      let pending: Promise<void> | null = null;
      let dirty = false;
      const readHost = async () => {
        try {
          const connection = getEnvironmentConnection(environment.id);
          const [tasks, inbox, runs] = await Promise.all([
            connection.call("automation.listTasks"),
            connection.call("automation.listInbox"),
            connection.call("automation.listRuns", { limit: 100 }),
          ]);
          const details = await Promise.all(
            tasks.tasks.map(async (task) => {
              const revision = await connection
                .call("automation.getTask", { taskId: task.id })
                .then((result) => result.task)
                .catch(() => null);
              const latestRun =
                runs.runs.find((run) => run.taskId === task.id) ??
                (await connection
                  .call("automation.listRuns", { taskId: task.id, limit: 1 })
                  .then((result) => result.runs[0] ?? null)
                  .catch(() => null));
              return { revision, latestRun };
            }),
          );
          if (disposed || generation.current !== epoch) return;
          const next: HostData = {
            tasks: tasks.tasks.map((task, index) => ({
              environmentId: environment.id,
              task,
              revision: details[index].revision,
              latestRun: details[index].latestRun,
            })),
            inbox: inbox.items.map((item) => ({ environmentId: environment.id, item })),
            runs: runs.runs.map((run) => ({ environmentId: environment.id, run })),
            error: null,
            loading: false,
          };
          setData((previous) => ({ ...previous, [environment.id]: next }));
        } catch (error) {
          if (!disposed && generation.current === epoch)
            setData((previous) => ({
              ...previous,
              [environment.id]: {
                ...(previous[environment.id] ?? emptyHostData),
                loading: false,
                error: error instanceof Error ? error.message : String(error),
              },
            }));
        }
      };
      const refresh = (): Promise<void> => {
        if (disposed) return Promise.resolve();
        dirty = true;
        if (pending) return pending;
        pending = (async () => {
          do {
            dirty = false;
            await readHost();
          } while (dirty && !disposed);
        })().finally(() => {
          pending = null;
        });
        return pending;
      };
      refreshers.current.set(environment.id, refresh);
      void refresh();
      void getEnvironmentConnection(environment.id)
        .subscribe(
          "automation.changed",
          "*",
          () => {
            void refresh();
          },
          () => {
            void refresh();
          },
        )
        .then((unsubscribe) => {
          if (disposed) unsubscribe();
          else unsubscribes.push(unsubscribe);
        })
        .catch(() => {});
    }
    return () => {
      disposed = true;
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [connectedKey]);

  const refresh = useCallback(async () => {
    await Promise.all([...refreshers.current.values()].map((refreshHost) => refreshHost()));
  }, []);
  const reconnectEnvironment = useCallback(async (environmentId: EnvironmentId) => {
    await runEnvironmentCommand({ type: "connect", environmentId });
  }, []);
  const command = useCallback(
    async <C extends AutomationCommand>(command: C, label?: string): Promise<AutomationCommandResult<C>> => {
      const native = command.type === "enable-task" || command.type === "resolve-attention";
      if (native && consentPending.current)
        throw new Error(
          t(
            "autoPageConsentAlreadyPending",
            "Finish the open system confirmation before starting another authorization.",
          ),
        );
      if (native) {
        consentPending.current = true;
        setNativeConsentPending({ label: label ?? t("autoPageConsentReview", "Review automation authorization") });
      }
      let result: AutomationCommandResult<C>;
      try {
        result = await window.piBridge.automationCommand(command);
      } finally {
        if (native) {
          consentPending.current = false;
          setNativeConsentPending(null);
        }
      }
      if (command.type !== "list-secret-names") await refresh();
      return result;
    },
    [refresh],
  );
  const hosts: readonly AutomationHost[] = useMemo(
    () =>
      environments.map((environment) => ({
        environment,
        status: hostStatus(environment),
        error: data[environment.id]?.error ?? null,
        loading: hostStatus(environment) === "online" && (data[environment.id]?.loading ?? true),
      })),
    [environments, data],
  );
  const availableData = environments
    .map((environment) => data[environment.id])
    .filter((entry): entry is HostData => Boolean(entry));
  const tasks = availableData.flatMap((entry) => entry.tasks);
  const inbox = availableData
    .flatMap((entry) => entry.inbox)
    .sort((a, b) => Number(b.item.kind === "attention") - Number(a.item.kind === "attention"));
  const runs = availableData.flatMap((entry) => entry.runs).sort((a, b) => b.run.createdAtMs - a.run.createdAtMs);
  return {
    hosts,
    tasks,
    inbox,
    runs,
    loading: hosts.some((host) => host.loading),
    nativeConsentPending,
    refresh,
    reconnectEnvironment,
    command,
    call: automationCall,
  };
}
