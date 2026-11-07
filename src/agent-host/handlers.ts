import type { RpcServer } from "../contract/rpc";
import { registerAgentHandlers } from "./handlers/agent";
import { registerAutomationHandlers } from "./handlers/automation";
import { ChannelManager, type ChannelManagerOptions } from "./channels/channel-manager";
import { ensureSessionEvents } from "./session-event-binding";
import { desktopUserDataPath } from "./desktop-state-file";
import { createAutomationRuntime, type AutomationRuntimeDeps } from "./automation";
import { callMain } from "./parent-rpc";
import path from "node:path";
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
import { getRpcSessionStatuses, listRpcSessions, subscribeRunningSessions } from "./rpc-manager";
import { initializeSessionLauncher, launchAutomationSession } from "./session-launcher";
import { initializeSessionOrchestrationService } from "./session-orchestration/service";
import { initializeSessionOrchestrationSettings } from "./session-orchestration/settings";
export { applySessionNameIfEmpty } from "./session-naming";
export { credentialMutationFailure } from "./handlers/auth";
export { initializeChannels } from "./handlers/channels";
export { projectModelsList } from "./handlers/models";
export { createAgentNewLockKey } from "./session-event-binding";
export interface HostHandlerOptions {
  readonly channels?: ChannelManagerOptions;
  readonly automation?: Pick<AutomationRuntimeDeps, "dataDirectory" | "limits">;
}
export function registerHandlers(server: RpcServer, options: HostHandlerOptions = {}): () => Promise<void> {
  const unsubscribeRunning = subscribeRunningSessions((ids) => {
    server.emit("agent.running", "*", {
      type: "running",
      sessionIds: ids,
      runningSessionIds: ids,
      sessionStatuses: getRpcSessionStatuses(),
    } as never);
    try {
      process.parentPort?.postMessage({ type: "running-sessions", sessionIds: ids });
    } catch {}
  });
  const managedProcesses = initializeManagedProcessService(server);
  initializeSessionLauncher(server);
  initializeSessionOrchestrationService();
  initializeSessionOrchestrationSettings();
  const processCleanup = registerProcessHandlers(server, { managedProcesses });
  const sessionsCleanup = registerSessionHandlers(server, { managedProcesses });
  registerAgentHandlers(server);
  const channelManager = new ChannelManager(
    server,
    (session, sessionId) => ensureSessionEvents(server, session, sessionId),
    options.channels,
  );
  const channelsCleanup = registerChannelHandlers(server, channelManager);
  const automationRuntime = createAutomationRuntime({
    dataDirectory: path.join(desktopUserDataPath(), "automation"),
    channels: channelManager,
    agentSessions: { launch: launchAutomationSession },
    secrets: { read: (name) => callMain<string | null>("automationSecrets.get", { name }) },
    ...options.automation,
  });
  const automationCleanup = registerAutomationHandlers(server, automationRuntime);
  const automationStarted = automationRuntime.start();
  const filesCleanup = registerFileHandlers(server);
  const modelsCleanup = registerModelHandlers(server);
  registerModelsConfigHandlers(server);
  registerAuthHandlers(server);
  registerProjectHandlers(server, {
    managedProcesses,
    runningSessionCwds: () =>
      listRpcSessions()
        .filter((session) => session.isRunning())
        .map((session) => session.cwd),
  });
  registerResourceHandlers(server);
  registerHostHandlers(server);
  return async () => {
    await automationStarted;
    await automationRuntime.stop();
    automationCleanup();
    await modelsCleanup();
    await processCleanup();
    await channelsCleanup();
    await filesCleanup();
    await sessionsCleanup();
    unsubscribeRunning();
  };
}
