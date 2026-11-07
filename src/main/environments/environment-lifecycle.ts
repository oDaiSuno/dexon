import type { LifecyclePolicy, RemoteDaemonChoice, RemoveOutcome } from "../../contract/environment-commands.ts";
export type EnvironmentCloseMode = "disconnect" | "stop-managed";
export function closeModeFor(
  cause: "disconnect" | "shutdown" | "reconfigure",
  policy: LifecyclePolicy,
): EnvironmentCloseMode {
  return cause !== "reconfigure" && !policy.detachedDaemon ? "stop-managed" : "disconnect";
}
export async function removeWithChoice(
  choice: RemoteDaemonChoice,
  actions: {
    stopManaged: () => Promise<RemoveOutcome["remoteDaemon"]>;
    disconnect: () => Promise<void>;
    remove: () => void;
  },
): Promise<RemoveOutcome> {
  let remoteDaemon: RemoveOutcome["remoteDaemon"] = "kept";
  if (choice === "stop") {
    try {
      remoteDaemon = await actions.stopManaged();
    } catch {
      remoteDaemon = "unreachable";
    }
  }
  await actions.disconnect();
  actions.remove();
  return { remoteDaemon };
}
export async function shutdownAll(actions: readonly (() => Promise<void>)[], timeoutMs = 4000): Promise<void> {
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
