import { ENVIRONMENT_SHUTDOWN_BUDGET_MS } from "../../shared/shutdown-budget.ts";
import type { EnvironmentTarget } from "../../contract/environment.ts";
import type { LifecyclePolicy, RemoteDaemonChoice, RemoveOutcome } from "../../contract/environment-commands.ts";
export type EnvironmentCloseMode = "disconnect" | "stop-managed";
export function closeModeFor(
  cause: "disconnect" | "shutdown" | "reconfigure",
  policy: LifecyclePolicy,
  target?: EnvironmentTarget,
): EnvironmentCloseMode {
  if (cause === "reconfigure") return "disconnect";
  if (target?.kind === "ssh" && typeof target.stopOnDisconnect === "boolean")
    return target.stopOnDisconnect ? "stop-managed" : "disconnect";
  return !policy.detachedDaemon ? "stop-managed" : "disconnect";
}
export async function removeWithChoice(
  choice: RemoteDaemonChoice,
  actions: {
    stopManaged: () => Promise<RemoveOutcome["remoteDaemon"]>;
    disconnect: () => Promise<void>;
    remove: () => void;
  },
): Promise<RemoveOutcome> {
  await actions.disconnect();
  let remoteDaemon: RemoveOutcome["remoteDaemon"] = "kept";
  if (choice === "stop") {
    try {
      remoteDaemon = await actions.stopManaged();
    } catch {
      remoteDaemon = "unreachable";
    }
  }
  actions.remove();
  return { remoteDaemon };
}
export class EnvironmentOperationQueue {
  private readonly locks = new Map<string, Promise<void>>();

  get pending(): Promise<void>[] {
    return [...this.locks.values()];
  }

  async run<T>(environmentId: string, action: () => Promise<T>): Promise<T> {
    const running = (this.locks.get(environmentId) ?? Promise.resolve()).then(action);
    const settled = running.then(
      () => undefined,
      () => undefined,
    );
    this.locks.set(environmentId, settled);
    try {
      return await running;
    } finally {
      if (this.locks.get(environmentId) === settled) this.locks.delete(environmentId);
    }
  }
}

export async function shutdownAll(
  actions: readonly (() => Promise<void>)[],
  timeoutMs = ENVIRONMENT_SHUTDOWN_BUDGET_MS,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.allSettled(actions.map((action) => action())),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
