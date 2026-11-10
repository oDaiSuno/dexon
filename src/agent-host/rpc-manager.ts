import { createEventBus } from "@earendil-works/pi-coding-agent";
import { createAutomationResultTool } from "./agent-session/automation-result-tool";
import {
  customToolsFor,
  executionProfileExtension,
  extensionLoadingFor,
  profileFromOrigin,
  immutableExecutionProfile,
  type SessionExecutionProfile,
} from "./agent-session/execution-profile";
import { getSessionOrigin, setSessionOrigin, type SetSessionOriginInput } from "./session-origin-store";
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

import { getLegacySessionToolNames } from "./agent-session/compat";
import { EXCLUDED_SDK_TOOL_NAMES } from "./agent-session/excluded-tools";
import { AgentSessionWrapper } from "./agent-session/wrapper";
import type { AgentSessionLike, ToolLoadoutReader } from "../shared/pi-types";
import type { SessionLiveStatus } from "../shared/session-orchestration";
import type { SessionEntry } from "../shared/types";
import type { HostActivitySnapshot } from "../shared/host-protocol";
export { getLegacySessionToolNames } from "./agent-session/compat";
export type { AgentEvent, ExternalSessionCommand, OrchestratedTurnOutcome } from "./agent-session/types";
export { renderToolchainSection, RunPolicy } from "./agent-session/run-policy";
export { AgentSessionWrapper } from "./agent-session/wrapper";

const sessionRegistry = new Map<string, AgentSessionWrapper>();
const startLocks = new Map<string, Promise<{ session: AgentSessionWrapper; realSessionId: string }>>();
const runningListeners = new Set<(ids: string[]) => void>();
const activityListeners = new Set<(activity: HostActivitySnapshot) => void>();
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

function getRunningListeners(): Set<(ids: string[]) => void> {
  return runningListeners;
}

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

export function activitySnapshot(): HostActivitySnapshot {
  return { running: getRunningRpcSessionIds(), starting: [...startLocks.keys()] };
}

export function subscribeActivity(listener: (activity: HostActivitySnapshot) => void): () => void {
  activityListeners.add(listener);
  listener(activitySnapshot());
  return () => {
    activityListeners.delete(listener);
  };
}

let lastRunningSnapshot = "";
let lastActivitySnapshot = "";

export function notifyRunningChange(): void {
  const activity = activitySnapshot();
  const activityKey = JSON.stringify([[...activity.running].sort(), [...activity.starting].sort()]);
  if (activityKey !== lastActivitySnapshot) {
    lastActivitySnapshot = activityKey;
    for (const listener of activityListeners) {
      try {
        listener(activity);
      } catch {}
    }
  }
  const ids = [...activity.running];
  const statuses = getRpcSessionStatuses();
  const snapshot = JSON.stringify([[...ids].sort(), Object.entries(statuses).sort()]);
  if (snapshot === lastRunningSnapshot) return;
  lastRunningSnapshot = snapshot;
  for (const listener of getRunningListeners()) {
    try {
      listener(ids);
    } catch {}
  }
}

export interface RpcSessionStartOptions {
  readonly profile?: SessionExecutionProfile;
  readonly origin?: SetSessionOriginInput;
}

export async function startRpcSession(
  sessionId: string,
  sessionFile: string,
  cwd: string,
  tools?: ToolIntent | readonly string[],
  initialModel?: { provider: string; modelId: string },
  options: RpcSessionStartOptions = {},
): Promise<{ session: AgentSessionWrapper; realSessionId: string }> {
  const registry = getRegistry();
  const locks = getLocks();

  const existing = registry.get(sessionId);
  if (existing?.isAlive()) {
    if (options.profile?.kind === "automation") throw new Error("Automation sessions cannot reuse a live session");
    return { session: existing, realSessionId: sessionId };
  }

  const inflight = locks.get(sessionId);
  if (inflight) return inflight;

  const starting = (async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
    const agentDir = getAgentDir();

    const sessionManager = sessionFile
      ? SessionManager.open(sessionFile, undefined)
      : SessionManager.create(cwd, configuredSessionDir());
    const managerSessionId = sessionManager.getSessionId();
    const origin =
      options.profile?.kind === "automation"
        ? { relation: "automation" as const, sourceType: "automation", automationStep: options.profile.step }
        : options.origin;
    const priorOrigin = getSessionOrigin(managerSessionId);
    if (origin && priorOrigin?.relation !== "automation") setSessionOrigin(managerSessionId, origin);
    const intent = adoptBirthToolIntent(desktopToolIntents, managerSessionId, {
      requested: tools ?? (options.profile?.kind === "interactive" ? options.profile.toolNames : undefined),
      legacy: getLegacySessionToolNames(sessionManager),
    });
    const profile = immutableExecutionProfile(
      options.profile?.kind === "automation"
        ? options.profile
        : profileFromOrigin(
            getSessionOrigin(managerSessionId),
            intent.kind === "bare" ? [] : intent.coding === "all" ? undefined : intent.coding,
          ),
    );
    const interactive = extensionLoadingFor(profile) === "user_and_project";
    installManagedProcessSessionRedaction(sessionManager);
    applyStoredLeafChoice(managerSessionId, sessionManager);

    const bridge: { wrapper?: AgentSessionWrapper } = {};
    const events = createEventBus();
    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      resourceLoaderOptions: {
        eventBus: events,
        ...(interactive
          ? {
              extensionsOverride: createQuestionnaireOverride({
                events,
                request: (questions, signal) => {
                  if (!bridge.wrapper) throw new Error("Session UI is not ready");
                  return bridge.wrapper.requestQuestionnaire(questions, signal);
                },
              }),
            }
          : { noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true }),
        extensionFactories: [
          interactive
            ? RunPolicy.extension(() => bridge.wrapper?.runPolicy)
            : executionProfileExtension(() => bridge.wrapper),
        ],
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
    const workspaceTools = [
      createDesktopBashToolDefinition(cwd, bashOptions),
      ...createDesktopSearchToolDefinitions(cwd, executionContext, toolchainRuntime),
    ];
    const allCustomTools = interactive
      ? [
          ...workspaceTools,
          ...createBrowserToolDefinitions(),
          ...(peekManagedProcessService()
            ? createManagedProcessToolDefinitions(
                cwd,
                services.settingsManager.isProjectTrusted(),
                peekManagedProcessService()!,
              )
            : []),
          ...createSessionOrchestrationToolDefinitions(),
        ]
      : [];
    const customTools = customToolsFor(
      profile,
      allCustomTools as unknown as NonNullable<CreateAgentSessionFromServicesOptions["customTools"]>,
      createAutomationResultTool,
    );
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
      ...(profile.kind === "automation"
        ? { tools: [...profile.tools, "automation_result"] }
        : profile.kind === "sealed"
          ? { tools: [] }
          : {}),
    });
    if (profile.kind === "automation") {
      for (const replacement of workspaceTools) {
        const definition = inner.getToolDefinition(replacement.name);
        if (definition) Object.assign(definition, { execute: replacement.execute });
      }
    }
    const realSessionId = inner.sessionId as string;
    const wrapper = new AgentSessionWrapper(inner as unknown as AgentSessionLike & ToolLoadoutReader, {
      profile,
      intents: desktopToolIntents,
      toolchain: renderToolchainSection(executionContext.inventoryRevision, executionContext.summary),
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
  })().finally(() => {
    locks.delete(sessionId);
    notifyRunningChange();
  });

  locks.set(sessionId, starting);
  notifyRunningChange();
  return starting;
}
