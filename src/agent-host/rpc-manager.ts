import { createEventBus } from "@earendil-works/pi-coding-agent";
import { createQuestionnaireOverride } from "./agent-session/questionnaire-adapter";
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  createBashToolDefinition,
  getAgentDir,
  SessionManager,
  type CreateAgentSessionFromServicesOptions,
} from "@earendil-works/pi-coding-agent";
import { browserAgentRuntime } from "./browser-agent-runtime";
import { createBrowserToolDefinitions } from "./browser-tools";
import { peekManagedProcessService } from "./managed-process/runtime";
import { installManagedProcessSessionRedaction } from "./managed-process/session-redaction";
import { createManagedProcessToolDefinitions } from "./managed-process/tools";
import { createSessionOrchestrationToolDefinitions } from "./session-orchestration/tools";
import { cacheSessionPath } from "./session-reader";
import { configuredSessionDir } from "./session-dir";
import { getDesktopSessionToolNames, setDesktopSessionToolNames } from "./session-tool-store";
import { createToolchainBashOptions } from "./toolchain-bash";
import { toolchainRuntime } from "./toolchain-runtime";
import { createDesktopSearchToolDefinitions } from "./toolchain-search";

import { getLegacySessionToolNames, withExtensionTools } from "./agent-session/compat";
import { AgentSessionWrapper } from "./agent-session/wrapper";
import type { SessionLiveStatus } from "../shared/session-orchestration";
export { getLegacySessionToolNames, withExtensionTools } from "./agent-session/compat";
export type { AgentEvent, ExternalSessionCommand, OrchestratedTurnOutcome } from "./agent-session/types";
export { AgentSessionWrapper } from "./agent-session/wrapper";
// ============================================================================
// Session registry
// ============================================================================

const sessionRegistry = new Map<string, AgentSessionWrapper>();
const startLocks = new Map<string, Promise<{ session: AgentSessionWrapper; realSessionId: string }>>();
const runningListeners = new Set<(ids: string[]) => void>();
let registryCleanupInstalled = false;

function getRegistry(): Map<string, AgentSessionWrapper> {
  if (!registryCleanupInstalled) {
    registryCleanupInstalled = true;
    const cleanup = () => sessionRegistry.forEach((session) => session.destroy());
    process.once("exit", cleanup);
    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);
  }
  return sessionRegistry;
}

function getLocks(): Map<string, Promise<{ session: AgentSessionWrapper; realSessionId: string }>> {
  return startLocks;
}

export function getRpcSession(sessionId: string): AgentSessionWrapper | undefined {
  return getRegistry().get(sessionId);
}

export function listRpcSessions(): AgentSessionWrapper[] {
  return [...getRegistry().values()];
}

export async function disposeAllRpcSessions(reason = "host-shutdown"): Promise<void> {
  await Promise.all([...getRegistry().values()].map((session) => session.dispose({ abort: true, reason })));
}

export function syncBrowserToolsForAllSessions(): void {
  for (const session of getRegistry().values()) session.syncBrowserToolActivation();
}

export function getRunningRpcSessionIds(): string[] {
  const ids = new Set<string>();
  for (const [sessionId, session] of getRegistry()) {
    if (session.isRunning()) ids.add(session.sessionId || sessionId);
  }
  return [...ids];
}

export function getRpcSessionStatuses(): Record<string, SessionLiveStatus> {
  const statuses: Record<string, SessionLiveStatus> = {};
  for (const [sessionId, session] of getRegistry()) {
    const status = session.liveStatus();
    if (status !== "idle") statuses[session.sessionId || sessionId] = status;
  }
  return statuses;
}

export function syncSessionToolsForAllSessions(): void {
  for (const session of getRegistry().values()) session.syncSessionToolActivation();
}

// ----------------------------------------------------------------------------
// Running-status broadcaster
//
// Pushes the current set of running session ids to subscribers whenever any
// session's running state may have changed. This lets the sidebar receive live
// MessagePort updates instead of polling.
// ----------------------------------------------------------------------------

function getRunningListeners(): Set<(ids: string[]) => void> {
  return runningListeners;
}

/** Subscribe to running-session-id changes. Returns an unsubscribe function. */
export function subscribeRunningSessions(listener: (ids: string[]) => void): () => void {
  const listeners = getRunningListeners();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Subscribe to every status broadcast, including awaiting-input and failure transitions. */
export function subscribeSessionStatuses(listener: () => void): () => void {
  return subscribeRunningSessions(() => listener());
}

let lastRunningSnapshot = "";

/**
 * Recompute the running-session-id set and, if it changed since the last
 * notification, broadcast it to subscribers. Cheap to call often.
 */
export function notifyRunningChange(): void {
  const ids = getRunningRpcSessionIds();
  const statuses = getRpcSessionStatuses();
  const snapshot = JSON.stringify([[...ids].sort(), Object.entries(statuses).sort()]);
  if (snapshot === lastRunningSnapshot) return;
  lastRunningSnapshot = snapshot;
  for (const listener of getRunningListeners()) {
    try {
      listener(ids);
    } catch {
      /* ignore listener errors */
    }
  }
}

/**
 * Get or create an AgentSession for the given session.
 * For new sessions (sessionFile === ""), pi generates its own id.
 * Pass toolNames to pre-configure active tools (empty array = all tools disabled).
 */
export async function startRpcSession(
  sessionId: string,
  sessionFile: string,
  cwd: string,
  toolNames?: string[],
): Promise<{ session: AgentSessionWrapper; realSessionId: string }> {
  const registry = getRegistry();
  const locks = getLocks();

  const existing = registry.get(sessionId);
  if (existing?.isAlive()) return { session: existing, realSessionId: sessionId };

  const inflight = locks.get(sessionId);
  if (inflight) return inflight;

  const starting = (async () => {
    const agentDir = getAgentDir();

    const sessionManager = sessionFile
      ? SessionManager.open(sessionFile, undefined)
      : SessionManager.create(cwd, configuredSessionDir());
    installManagedProcessSessionRedaction(sessionManager);

    // Desktop-owned session choices live outside Pi's shared JSONL so the CLI
    // remains unaffected. Read the old custom entry only for one-way migration.
    const managerSessionId = sessionManager.getSessionId();
    const desktopToolNames = getDesktopSessionToolNames(managerSessionId);
    const legacyToolNames = desktopToolNames === undefined ? getLegacySessionToolNames(sessionManager) : undefined;
    const persistedToolNames = desktopToolNames ?? legacyToolNames;
    const sessionToolNames = persistedToolNames ?? toolNames;

    // Build services first so extension-registered providers are available
    // before the SDK restores the saved model from the session file.
    const bridge: { wrapper?: AgentSessionWrapper } = {};
    const events = createEventBus();
    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      resourceLoaderOptions: {
        eventBus: events,
        extensionsOverride: createQuestionnaireOverride({
          events,
          request: (questions, signal) => {
            if (!bridge.wrapper) throw new Error("Session UI is not ready");
            return bridge.wrapper.requestQuestionnaire(questions, signal);
          },
        }),
      },
    });
    const executionContext = await toolchainRuntime.createExecutionContext({
      cwd,
      intent: "agent-shell",
      trusted: services.settingsManager.isProjectTrusted(),
    });
    const bashOptions = createToolchainBashOptions(
      executionContext,
      toolchainRuntime,
      services.settingsManager.getShellCommandPrefix(),
      (command) => browserAgentRuntime.guardBash(sessionManager.getSessionId(), command),
    );
    const customTools = [
      createBashToolDefinition(cwd, bashOptions),
      ...createDesktopSearchToolDefinitions(cwd, executionContext, toolchainRuntime),
      ...createBrowserToolDefinitions(),
      ...(peekManagedProcessService()
        ? createManagedProcessToolDefinitions(
            cwd,
            services.settingsManager.isProjectTrusted(),
            peekManagedProcessService()!,
          )
        : []),
      ...createSessionOrchestrationToolDefinitions(),
    ] as unknown as NonNullable<CreateAgentSessionFromServicesOptions["customTools"]>;
    const { session: inner } = await createAgentSessionFromServices({
      services,
      sessionManager,
      customTools,
    });
    const realSessionId = inner.sessionId as string;

    // Keep every tool registered so a session initialized with no tools can enable
    // them later. Narrow only the active set, never the registry allow-list.
    if (sessionToolNames !== undefined) {
      inner.setActiveToolsByName(withExtensionTools(inner, sessionToolNames));
      if (desktopToolNames === undefined) setDesktopSessionToolNames(realSessionId, sessionToolNames);
    }

    const wrapper = new AgentSessionWrapper(inner, sessionToolNames);
    bridge.wrapper = wrapper;
    wrapper.setRuntimeDiagnostics(services.diagnostics);
    wrapper.setToolchainSummary(executionContext.inventoryRevision, executionContext.summary);
    wrapper.start();
    wrapper.syncBrowserToolActivation();
    wrapper.syncSessionToolActivation();

    const realSessionFile = inner.sessionFile as string | undefined;
    if (realSessionFile) cacheSessionPath(realSessionId, realSessionFile);

    wrapper.onDestroy(() => registry.delete(realSessionId));
    registry.set(realSessionId, wrapper);
    wrapper.beginExtensionBinding({ forceEmptySystemPrompt: sessionToolNames?.length === 0 });

    return { session: wrapper, realSessionId };
  })().finally(() => locks.delete(sessionId));

  locks.set(sessionId, starting);
  return starting;
}
