import { existsSync, realpathSync } from "node:fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  SESSION_ORCHESTRATION_LIMITS,
  type SessionLiveStatus,
  type SessionModelRef,
  type SessionSourceRef,
} from "../../shared/session-orchestration";
import { resolveProject } from "../../shared/worktree";
import { worktreePathsEqual } from "../../shared/worktree-path";
import {
  getRpcSession,
  listRpcSessions,
  startRpcSession,
  type AgentSessionWrapper,
  type OrchestratedTurnOutcome,
} from "../rpc-manager";
import { ensureSessionEvents } from "../session-event-binding";
import {
  launchDesktopSession,
  sessionLauncherServer,
  type DesktopSessionLaunch,
  type LaunchedDesktopSession,
} from "../session-launcher";
import { getSessionOrigin, setSessionOrigin } from "../session-origin-store";
import { resolveSessionPath } from "../session-reader";
import {
  CALLER_ONLY_REFUSAL,
  CROSS_PROJECT_REFUSAL,
  OWNER_DISABLED_REFUSAL,
  runningLimitRefusal,
  SELF_TARGET_REFUSAL,
  SessionOrchestrationError,
  throwIfAborted,
} from "./errors";
import {
  clampNumber,
  listSessionViews,
  liveStatusOf,
  readSessionView,
  type SessionReadView,
  type SessionToolView,
} from "./inspection";
import { getSessionOrchestrationSettings } from "./settings";
import { openSessionWait, waitForSessionOutcome, type SessionWaitResult } from "./waiting";

export type { SessionReadView, SessionToolCallSummary, SessionToolView } from "./inspection";
export type { SessionWaitResult, SessionWaitStatus } from "./waiting";
export { SessionOrchestrationError } from "./errors";

function callerSourceTitle(caller: AgentSessionWrapper): string | undefined {
  const name = caller.inner.sessionName;
  return typeof name === "string" && name.trim() ? name.trim() : undefined;
}

export class SessionOrchestrationService {
  private pendingAgentLaunches = 0;

  runningAgentSessions(): number {
    return listRpcSessions().filter(
      (session) => session.isRunning() && getSessionOrigin(session.sessionId)?.createdBySessionId,
    ).length;
  }

  async create(
    callerId: string,
    input: {
      cwd?: string;
      name?: string;
      model?: SessionModelRef;
      thinkingLevel?: string;
      message: string;
      wait?: boolean;
      timeoutMs?: number;
    },
    signal?: AbortSignal,
  ): Promise<{ sessionId: string; name?: string; status: SessionLiveStatus | "idle"; wait?: SessionWaitResult }> {
    throwIfAborted(signal);
    const settings = getSessionOrchestrationSettings();
    const caller = getRpcSession(callerId);
    if (!caller?.isAlive()) throw new SessionOrchestrationError("The calling session is no longer available");

    const cwd = input.cwd ?? caller.cwd;
    if (!cwd || !existsSync(cwd)) {
      throw new SessionOrchestrationError(`Directory does not exist: ${input.cwd ?? caller.cwd}`);
    }
    const [callerProject, targetProject] = await Promise.all([resolveProject(caller.cwd), resolveProject(cwd)]);
    if (!sameProjectRoot(callerProject.projectRoot, targetProject.projectRoot)) {
      throw new SessionOrchestrationError(CROSS_PROJECT_REFUSAL);
    }
    if (this.agentSessionLoad() >= settings.maxRunning) {
      throw new SessionOrchestrationError(runningLimitRefusal(settings.maxRunning));
    }

    const model = input.model ?? settings.model ?? callerModel(caller);
    const thinkingLevel = input.thinkingLevel ?? settings.thinkingLevel ?? callerThinkingLevel(caller);
    const name = input.name?.trim();
    const launched = await this.launchDelegate(callerId, {
      cwd,
      toolNames: caller.inner.getActiveToolNames(),
      ...(model ? { provider: model.provider, modelId: model.modelId } : {}),
      ...(thinkingLevel ? { thinkingLevel } : {}),
      ...(name ? { name } : {}),
      firstMessage: { text: input.message, source: this.callerSource(callerId) },
    });

    throwIfAborted(signal);
    const wait = input.wait
      ? await this.waitOn(callerId, launched.sessionId, input.timeoutMs, launched.turn, signal)
      : undefined;
    return {
      sessionId: launched.sessionId,
      ...(name ? { name } : {}),
      status: liveStatusOf(launched.sessionId),
      ...(wait ? { wait } : {}),
    };
  }

  async prompt(
    callerId: string,
    input: { sessionId: string; message: string; wait?: boolean; timeoutMs?: number },
    signal?: AbortSignal,
  ): Promise<{ sessionId: string; status: SessionLiveStatus | "idle"; wait?: SessionWaitResult }> {
    throwIfAborted(signal);
    if (input.sessionId === callerId) throw new SessionOrchestrationError(SELF_TARGET_REFUSAL);
    const settings = getSessionOrchestrationSettings();
    const origin = getSessionOrigin(input.sessionId);
    if (!settings.allowUserSessions && !origin?.createdBySessionId) {
      throw new SessionOrchestrationError(OWNER_DISABLED_REFUSAL);
    }

    const target = await this.requireLiveSession(input.sessionId);
    const wakingIdleAgentSession = !target.isRunning() && Boolean(origin?.createdBySessionId);
    if (wakingIdleAgentSession && this.agentSessionLoad() >= settings.maxRunning) {
      throw new SessionOrchestrationError(runningLimitRefusal(settings.maxRunning));
    }

    throwIfAborted(signal);
    const turnParams = { message: input.message, source: this.callerSource(callerId) };
    const turn = wakingIdleAgentSession
      ? this.startTurnWithReservedSlot(target, turnParams)
      : target.runOrchestratedTurn(turnParams);
    const wait = input.wait ? await this.waitOn(callerId, input.sessionId, input.timeoutMs, turn, signal) : undefined;
    return {
      sessionId: input.sessionId,
      status: liveStatusOf(input.sessionId),
      ...(wait ? { wait } : {}),
    };
  }

  async wait(
    callerId: string,
    sessionId: string,
    timeoutMs: number | undefined,
    signal?: AbortSignal,
  ): Promise<SessionWaitResult> {
    return this.waitOn(callerId, sessionId, timeoutMs, undefined, signal);
  }

  async list(
    callerId: string,
    input: { scope?: "project" | "all"; limit?: number },
  ): Promise<{ sessions: SessionToolView[] }> {
    const caller = getRpcSession(callerId);
    const callerProjectRoot = caller ? (await resolveProject(caller.cwd)).projectRoot : undefined;
    return listSessionViews({ callerId, callerProjectRoot, ...input });
  }

  read(sessionId: string, input: { maxChars?: number; toolCalls?: number }): Promise<SessionReadView> {
    return readSessionView({ sessionId, ...input });
  }

  async stop(callerId: string, sessionId: string): Promise<{ sessionId: string; status: SessionLiveStatus | "idle" }> {
    this.requireOwnedSession(callerId, sessionId, "stopped");
    const target = await this.requireLiveSession(sessionId);
    await target.send({ type: "abort" });
    return { sessionId, status: liveStatusOf(sessionId) };
  }

  async close(callerId: string, sessionId: string): Promise<{ sessionId: string; status: "closed" }> {
    this.requireOwnedSession(callerId, sessionId, "closed");
    const target = getRpcSession(sessionId);
    if (target?.isAlive()) await target.dispose({ abort: true, reason: "agent-session-close" });
    return { sessionId, status: "closed" };
  }

  private agentSessionLoad(): number {
    return this.runningAgentSessions() + this.pendingAgentLaunches;
  }

  private async launchDelegate(callerId: string, launch: DesktopSessionLaunch): Promise<LaunchedDesktopSession> {
    this.pendingAgentLaunches += 1;
    try {
      const launched = await launchDesktopSession(launch);
      setSessionOrigin(launched.sessionId, { relation: "delegate", createdBySessionId: callerId });
      return launched;
    } finally {
      this.pendingAgentLaunches = Math.max(0, this.pendingAgentLaunches - 1);
    }
  }

  private startTurnWithReservedSlot(
    target: AgentSessionWrapper,
    params: { message: string; source?: SessionSourceRef },
  ): Promise<OrchestratedTurnOutcome> {
    this.pendingAgentLaunches += 1;
    try {
      return target.runOrchestratedTurn(params);
    } finally {
      this.pendingAgentLaunches = Math.max(0, this.pendingAgentLaunches - 1);
    }
  }

  private async waitOn(
    callerId: string,
    targetSessionId: string,
    timeoutMs: number | undefined,
    turn: Promise<OrchestratedTurnOutcome> | undefined,
    signal: AbortSignal | undefined,
  ): Promise<SessionWaitResult> {
    const release = openSessionWait(callerId, targetSessionId);
    try {
      return await waitForSessionOutcome({
        sessionId: targetSessionId,
        timeoutMs: this.waitTimeout(timeoutMs),
        ...(turn ? { turn } : {}),
        ...(signal ? { signal } : {}),
      });
    } finally {
      release();
    }
  }

  private callerSource(callerId: string): SessionSourceRef {
    const caller = getRpcSession(callerId);
    const title = caller ? callerSourceTitle(caller) : undefined;
    return { sessionId: callerId, ...(title ? { title } : {}) };
  }

  private waitTimeout(timeoutMs: number | undefined): number {
    return clampNumber(
      timeoutMs,
      SESSION_ORCHESTRATION_LIMITS.waitDefaultMs,
      0,
      SESSION_ORCHESTRATION_LIMITS.waitMaxMs,
    );
  }

  private requireOwnedSession(callerId: string, sessionId: string, action: string): void {
    const origin = getSessionOrigin(sessionId);
    if (!origin?.createdBySessionId || origin.createdBySessionId !== callerId) {
      throw new SessionOrchestrationError(`${CALLER_ONLY_REFUSAL} ${action}`);
    }
  }

  private async requireLiveSession(sessionId: string): Promise<AgentSessionWrapper> {
    const existing = getRpcSession(sessionId);
    if (existing?.isAlive()) return existing;
    const filePath = await resolveSessionPath(sessionId);
    if (!filePath) throw new SessionOrchestrationError(`Session ${sessionId} was not found`);
    const cwd = SessionManager.open(filePath).getHeader()?.cwd ?? process.cwd();
    const { session } = await startRpcSession(sessionId, filePath, cwd);
    ensureSessionEvents(sessionLauncherServer(), session, sessionId);
    return session;
  }
}

function canonicalProjectRoot(root: string): string {
  try {
    return realpathSync.native(root);
  } catch {
    return root;
  }
}

function sameProjectRoot(left: string, right: string): boolean {
  return worktreePathsEqual(canonicalProjectRoot(left), canonicalProjectRoot(right));
}

function callerModel(caller: AgentSessionWrapper): SessionModelRef | undefined {
  const model = caller.inner.model;
  return model ? { provider: model.provider, modelId: model.id } : undefined;
}

function callerThinkingLevel(caller: AgentSessionWrapper): string | undefined {
  const level = caller.inner.agent.state?.thinkingLevel;
  return typeof level === "string" && level ? level : undefined;
}

let service: SessionOrchestrationService | null = null;

export function initializeSessionOrchestrationService(): SessionOrchestrationService {
  service ??= new SessionOrchestrationService();
  return service;
}

export function getSessionOrchestrationService(): SessionOrchestrationService {
  if (!service) throw new Error("Session orchestration service is not initialized");
  return service;
}
