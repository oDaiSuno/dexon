import { createEventBus } from "@earendil-works/pi-coding-agent";
import { createQuestionnaireOverride } from "./agent-session/questionnaire-adapter";
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
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
import { chosenSessionModel } from "./session-model";
import { cacheSessionPath } from "./session-reader";
import { configuredSessionDir } from "./session-dir";
import { applyStoredLeafChoice, rememberLeafChoice } from "./session-leaf-store";
import { adoptBirthToolIntent, type ToolIntent } from "./agent-session/tool-intent";
import { renderToolchainSection, RunPolicy } from "./agent-session/run-policy";
import { desktopToolIntents } from "./session-tool-store";
import { createDesktopBashToolDefinition, createToolchainBashOptions } from "./toolchain-bash";
import { toolchainRuntime } from "./toolchain-runtime";
import { createDesktopSearchToolDefinitions } from "./toolchain-search";
import { parseWorkspaceInput, keyOf, type PosixAbsPath } from "../shared/workspace-ref.ts";
import { getOrCreateHost } from "./workspace/registry.ts";
import { createAllRemoteCodingTools } from "./workspace/coding-tools-remote.ts";
import { sessionDirFor, writeWorkspaceBinding } from "./workspace/session-binding.ts";

import { getLegacySessionToolNames } from "./agent-session/compat";
import { EXCLUDED_SDK_TOOL_NAMES } from "./agent-session/excluded-tools";
import { AgentSessionWrapper } from "./agent-session/wrapper";
import type { AgentSessionLike, ToolLoadoutReader } from "../shared/pi-types";
import type { SessionLiveStatus } from "../shared/session-orchestration";
import type { SessionEntry } from "../shared/types";
export { getLegacySessionToolNames } from "./agent-session/compat";
export type { AgentEvent, ExternalSessionCommand, OrchestratedTurnOutcome } from "./agent-session/types";
export { renderToolchainSection, RunPolicy } from "./agent-session/run-policy";
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

export async function startRpcSession(
  sessionId: string,
  sessionFile: string,
  cwd: string,
  tools?: ToolIntent | readonly string[],
  initialModel?: { provider: string; modelId: string },
): Promise<{ session: AgentSessionWrapper; realSessionId: string }> {
  const registry = getRegistry();
  const locks = getLocks();

  const existing = registry.get(sessionId);
  if (existing?.isAlive()) return { session: existing, realSessionId: sessionId };

  const inflight = locks.get(sessionId);
  if (inflight) return inflight;

  const starting = (async () => {
    const agentDir = getAgentDir();

    const workspaceRef = parseWorkspaceInput(cwd);
    const isRemote = workspaceRef.ok && workspaceRef.value.kind === "ssh";
    const remoteRef = isRemote ? (workspaceRef.value as Extract<typeof workspaceRef.value, { kind: "ssh" }>) : null;

    const smCwd = remoteRef ? (remoteRef.root as string) : cwd;
    const smSessionDir = remoteRef ? sessionDirFor(remoteRef, configuredSessionDir()) : configuredSessionDir();

    const sessionManager = sessionFile
      ? SessionManager.open(sessionFile, undefined)
      : SessionManager.create(smCwd, smSessionDir);
    installManagedProcessSessionRedaction(sessionManager);

    if (remoteRef) {
      writeWorkspaceBinding(sessionManager, remoteRef);
    }

    const managerSessionId = sessionManager.getSessionId();
    applyStoredLeafChoice(managerSessionId, sessionManager);

    const bridge: { wrapper?: AgentSessionWrapper } = {};
    const events = createEventBus();
    const services = await createAgentSessionServices({
      cwd: smCwd,
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
        extensionFactories: [RunPolicy.extension(() => bridge.wrapper?.runPolicy)],
      },
    });
    const remoteHost = remoteRef ? getOrCreateHost(keyOf(remoteRef)) : null;
    if (remoteRef && remoteHost) {
      await remoteHost.connect();
    }
    const remoteRoot = remoteRef ? (remoteRef.root as PosixAbsPath) : null;
    const trusted = remoteRef ? false : services.settingsManager.isProjectTrusted();
    const executionContext = isRemote
      ? {
          inventoryRevision: 0,
          resolutionId: "remote",
          nativeEnv: process.env,
          shellEnv: {},
          commands: {},
          summary: [],
        }
      : await toolchainRuntime.createExecutionContext({
          cwd,
          intent: "agent-shell",
          trusted: services.settingsManager.isProjectTrusted(),
        });
    const bashOptions = isRemote
      ? undefined
      : createToolchainBashOptions(
          executionContext as never,
          toolchainRuntime,
          services.settingsManager.getShellCommandPrefix(),
          (command) => browserAgentRuntime.guardBash(sessionManager.getSessionId(), command),
        );
    const customTools = [
      ...(isRemote && remoteHost
        ? createAllRemoteCodingTools(remoteRoot ?? "/", remoteHost)
        : [
            createDesktopBashToolDefinition(cwd, bashOptions!),
            ...createDesktopSearchToolDefinitions(cwd, executionContext as never, toolchainRuntime),
          ]),
      ...createBrowserToolDefinitions(),
      ...(peekManagedProcessService()
        ? createManagedProcessToolDefinitions(cwd, trusted, peekManagedProcessService()!)
        : []),
      ...createSessionOrchestrationToolDefinitions(),
    ] as unknown as NonNullable<CreateAgentSessionFromServicesOptions["customTools"]>;
    const chosen = chosenSessionModel(sessionManager.getBranch() as unknown as SessionEntry[]);
    const chosenModel = chosen.model
      ? services.modelRuntime.getModel(chosen.model.provider, chosen.model.modelId)
      : undefined;
    const requestedModel =
      !chosen.model && initialModel
        ? services.modelRuntime.getModel(initialModel.provider, initialModel.modelId)
        : undefined;
    const startModel = chosenModel ?? requestedModel;
    const reopenChoice: Pick<CreateAgentSessionFromServicesOptions, "model" | "thinkingLevel"> = {
      ...(startModel ? { model: startModel } : {}),
      ...(chosen.thinkingLevel
        ? { thinkingLevel: chosen.thinkingLevel as NonNullable<CreateAgentSessionFromServicesOptions["thinkingLevel"]> }
        : {}),
    };
    const { session: inner } = await createAgentSessionFromServices({
      services,
      sessionManager,
      ...reopenChoice,
      customTools,
      excludeTools: [...EXCLUDED_SDK_TOOL_NAMES],
    });
    const realSessionId = inner.sessionId as string;
    adoptBirthToolIntent(desktopToolIntents, realSessionId, {
      requested: tools,
      legacy: getLegacySessionToolNames(sessionManager),
    });

    const wrapper = new AgentSessionWrapper(inner as unknown as AgentSessionLike & ToolLoadoutReader, {
      intents: desktopToolIntents,
      toolchain: isRemote
        ? null
        : renderToolchainSection(
            (executionContext as never as { inventoryRevision: number }).inventoryRevision ?? 0,
            (executionContext as never as { summary: string[] }).summary ?? [],
          ),
    });
    if (chosen.model && !chosenModel) wrapper.sessionModel.adopt(chosen.model);
    bridge.wrapper = wrapper;
    wrapper.setRuntimeDiagnostics(services.diagnostics);
    wrapper.start();

    const realSessionFile = inner.sessionFile as string | undefined;
    if (realSessionFile) cacheSessionPath(realSessionId, realSessionFile);

    wrapper.onDestroy(() => {
      rememberLeafChoice(realSessionId, inner.sessionManager);
      registry.delete(realSessionId);
    });
    registry.set(realSessionId, wrapper);
    wrapper.beginExtensionBinding();

    return { session: wrapper, realSessionId };
  })().finally(() => locks.delete(sessionId));

  locks.set(sessionId, starting);
  return starting;
}
