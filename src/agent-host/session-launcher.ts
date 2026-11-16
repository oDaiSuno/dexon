import { stat } from "node:fs/promises";
import { readSessionHeader } from "./session-jsonl";
import { createAutomationResultSink } from "./agent-session/automation-result-tool";
import type {
  AgentWorkspaceTool,
  AutomationStepRef,
  AutomationResultContract,
} from "./agent-session/execution-profile";
import type { AutomationTurnOutput } from "./agent-session/automation-turn";
import type { EffectObservation } from "./effect-observation";
import type { SetSessionOriginInput } from "./session-origin-store";
import type { ToolIntent } from "./agent-session/tool-intent";
import type { RpcServer } from "../contract/rpc";
import { MissingSessionCwdError, RpcError } from "../contract/types";
import type { SessionSourceRef } from "../shared/session-orchestration";
import { allowFileRoot } from "./file-access";
import { startRpcSession, type AgentSessionWrapper, type OrchestratedTurnOutcome } from "./rpc-manager";
import { createAgentNewLockKey, ensureSessionEvents } from "./session-event-binding";
import { emitIndexedSessionChange, resolveSessionPath } from "./session-reader";
import { announceSessionOnFirstMessage } from "./session-source";

export interface DesktopSessionLaunch {
  cwd: string;
  tools?: ToolIntent | readonly string[];
  origin?: SetSessionOriginInput;
  provider?: string;
  modelId?: string;
  thinkingLevel?: string;
  name?: string;
  command?: Record<string, unknown>;
  firstMessage?: { text: string; source?: SessionSourceRef };
  announceChange?: boolean;
}

export interface LaunchedDesktopSession {
  sessionId: string;
  session: AgentSessionWrapper;
  data: unknown;
  turn?: Promise<OrchestratedTurnOutcome>;
}

let rpcServer: RpcServer | null = null;

export function initializeSessionLauncher(server: RpcServer): void {
  rpcServer = server;
}

export function sessionLauncherServer(): RpcServer {
  if (!rpcServer) throw new RpcError({ code: "INTERNAL", message: "Session launcher is not initialized" });
  return rpcServer;
}

export async function assertSessionCwdExists(cwd: string): Promise<void> {
  const isDirectory = await stat(cwd).then(
    (info) => info.isDirectory(),
    () => false,
  );
  if (!isDirectory) throw new MissingSessionCwdError(cwd);
}

export async function resumeStoredSession(sessionId: string): Promise<AgentSessionWrapper | null> {
  const filePath = await resolveSessionPath(sessionId);
  if (!filePath) return null;
  const cwd = (await readSessionHeader(filePath))?.cwd ?? process.cwd();
  await assertSessionCwdExists(cwd);
  const { session } = await startRpcSession(sessionId, filePath, cwd);
  ensureSessionEvents(sessionLauncherServer(), session, sessionId);
  return session;
}

export async function launchDesktopSession(launch: DesktopSessionLaunch): Promise<LaunchedDesktopSession> {
  const { cwd } = launch;
  if (!cwd || typeof cwd !== "string") throw new RpcError({ code: "BAD_REQUEST", message: "cwd is required" });
  await assertSessionCwdExists(cwd);

  const server = sessionLauncherServer();
  const initialModel =
    launch.provider && launch.modelId ? { provider: launch.provider, modelId: launch.modelId } : undefined;
  const { session, realSessionId } = await startRpcSession(
    createAgentNewLockKey(),
    "",
    cwd,
    launch.tools,
    initialModel,
    { origin: launch.origin },
  );
  allowFileRoot(cwd);

  ensureSessionEvents(server, session, realSessionId);
  announceSessionOnFirstMessage(server, session);

  const startedModel = session.sessionModel.current(session.inner);
  const alreadyOnRequestedModel =
    startedModel !== null && startedModel.provider === launch.provider && startedModel.modelId === launch.modelId;
  if (launch.provider && launch.modelId && !alreadyOnRequestedModel) {
    await session.send({ type: "set_model", provider: launch.provider, modelId: launch.modelId });
  }
  if (launch.thinkingLevel) {
    await session.send({ type: "set_thinking_level", level: launch.thinkingLevel });
  }
  if (launch.name) {
    await session.send({ type: "set_session_name", name: launch.name });
  }

  const turn = launch.firstMessage
    ? session.runOrchestratedTurn({
        message: launch.firstMessage.text,
        ...(launch.firstMessage.source ? { source: launch.firstMessage.source } : {}),
      })
    : undefined;
  const data = turn || !launch.command ? null : await session.send(launch.command);
  if (launch.announceChange !== false) await emitIndexedSessionChange(server, realSessionId, cwd);

  return { sessionId: realSessionId, session, data, ...(turn ? { turn } : {}) };
}

export type AutomationSessionLaunch<T = unknown> = {
  readonly cwd: string;
  readonly step: AutomationStepRef;
  readonly tools: readonly AgentWorkspaceTool[];
  readonly provider?: string;
  readonly modelId?: string;
  readonly model?: { readonly provider: string; readonly modelId: string } | null;
  readonly thinkingLevel?: string | null;
  readonly name?: string;
} & ({ readonly result: AutomationResultContract<T> } | { readonly resultSchema: Record<string, unknown> });

export interface AutomationSessionHandle<T = unknown> {
  readonly sessionId: string;
  runTurn(
    prompt: string,
    options: { readonly timeoutMs: number; readonly signal?: AbortSignal },
  ): Promise<EffectObservation<AutomationTurnOutput<T>>>;
  dispose(): Promise<void>;
}

export async function launchAutomationSession<T = unknown>(
  launch: AutomationSessionLaunch<T>,
): Promise<AutomationSessionHandle<T>> {
  if (
    !launch.cwd ||
    !(await stat(launch.cwd).then(
      (info) => info.isDirectory(),
      () => false,
    ))
  )
    throw new RpcError({ code: "BAD_REQUEST", message: "Automation cwd must be an existing directory" });
  const result =
    "result" in launch
      ? launch.result
      : { schema: launch.resultSchema, sink: createAutomationResultSink<T>(launch.resultSchema) };
  const initialModel =
    launch.model ??
    (launch.provider && launch.modelId ? { provider: launch.provider, modelId: launch.modelId } : undefined);
  const { session, realSessionId } = await startRpcSession(
    createAgentNewLockKey(),
    "",
    launch.cwd,
    undefined,
    initialModel,
    {
      profile: { kind: "automation", step: launch.step, tools: launch.tools, result },
      origin: { relation: "automation", sourceType: "automation", automationStep: launch.step },
    },
  );
  const dispose = () => session.dispose({ abort: true, reason: "automation-step-ended" });
  try {
    ensureSessionEvents(sessionLauncherServer(), session, realSessionId);
    await session.configureLaunch({
      ...(initialModel ? initialModel : {}),
      ...(launch.thinkingLevel ? { thinkingLevel: launch.thinkingLevel } : {}),
      ...(launch.name ? { name: launch.name } : {}),
    });
  } catch (error) {
    await dispose();
    throw error;
  }
  let started = false;
  return {
    sessionId: realSessionId,
    async runTurn(prompt, options) {
      if (started || !session.isAlive())
        return {
          kind: "not_applied",
          transient: false,
          error: { code: "invalid_input", message: "Automation session supports only one turn" },
        };
      started = true;
      try {
        return await session.runAutomationTurn(prompt, { ...options, sink: result.sink });
      } finally {
        await dispose();
      }
    },
    dispose,
  };
}
