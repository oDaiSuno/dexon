/**
 * Register all Api handlers on the RPC server.
 * Implements the desktop RPC contract in the Agent Host process.
 *
 * This is a thin composition root: domain registrars under ./handlers/ own
 * their services and method subsets. The root only wires host-level streams,
 * initializes the shared managed-process service, and aggregates cleanup in
 * the original registration order of the pre-split implementation.
 */
import type { RpcServer } from "../contract/rpc";
import { registerAgentHandlers } from "./handlers/agent";
import { registerAuthHandlers } from "./handlers/auth";
import { registerChannelHandlers } from "./handlers/channels";
import { registerFileHandlers } from "./handlers/files";
import { registerHostHandlers } from "./handlers/host";
import { registerModelHandlers } from "./handlers/models";
import { registerModelsConfigHandlers } from "./handlers/models-config";
import { registerProcessHandlers } from "./handlers/processes";
import { registerProjectHandlers } from "./handlers/project";
import { registerResourceHandlers } from "./handlers/resources";
import { registerSessionHandlers } from "./handlers/sessions";
import { initializeManagedProcessService } from "./managed-process/runtime";
import { subscribeRunningSessions } from "./rpc-manager";

export { applySessionNameIfEmpty, generateSessionTitleWithFallback } from "./handlers/agent";
export { credentialMutationFailure } from "./handlers/auth";
export { initializeChannels } from "./handlers/channels";
export { projectModelsList } from "./handlers/models";
export { createAgentNewLockKey } from "./session-event-binding";

export function registerHandlers(server: RpcServer): () => Promise<void> {
  // Running sessions stream + tray badge signal to main via parentPort
  subscribeRunningSessions((ids) => {
    // Both fields remain in the current stream contract for renderer compatibility.
    server.emit("agent.running", "*", {
      type: "running",
      sessionIds: ids,
      runningSessionIds: ids,
    } as never);
    try {
      process.parentPort?.postMessage({ type: "running-sessions", sessionIds: ids });
    } catch {
      /* ignore */
    }
  });

  const managedProcesses = initializeManagedProcessService(server);

  const processCleanup = registerProcessHandlers(server, { managedProcesses });
  const sessionsCleanup = registerSessionHandlers(server, { managedProcesses });
  registerAgentHandlers(server);
  const channelsCleanup = registerChannelHandlers(server);
  const filesCleanup = registerFileHandlers(server);
  const modelsCleanup = registerModelHandlers(server);
  registerModelsConfigHandlers(server);
  registerAuthHandlers(server);
  registerProjectHandlers(server, { managedProcesses });
  registerResourceHandlers(server);
  registerHostHandlers(server);

  // Preserve the original cleanup sequence of the pre-split implementation:
  // model catalog refreshes, managed processes, channels, file watches, then
  // RPC sessions.
  return async () => {
    await modelsCleanup();
    await processCleanup();
    await channelsCleanup();
    await filesCleanup();
    await sessionsCleanup();
  };
}
