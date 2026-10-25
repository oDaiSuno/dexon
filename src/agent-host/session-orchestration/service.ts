import { existsSync } from "node:fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  SESSION_ORCHESTRATION_LIMITS,
  type SessionLaunchReport,
  type SessionLiveStatus,
  type SessionModelRef,
  type SessionSourceRef,
} from "../../shared/session-orchestration";
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
  FOREIGN_PROJECT_REFUSAL,
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
  sessionCwd,
  type SessionReadView,
  type SessionToolView,
} from "./inspection";
import { projectRootOf, sameProjectRoot } from "./project-scope";
import { getSessionOrchestrationSettings } from "./settings";
import { openSessionWait, waitForSessionOutcome, type SessionWaitResult } from "./waiting";

export type { SessionReadView, SessionToolView } from "./inspection";
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
      timeoutSeconds?: number;
    },
    signal?: AbortSignal,
  ): Promise<{
    sessionId: string;
    name?: string;
    status: SessionLiveStatus | "idle";
    wait?: SessionWaitResult;
    launch: SessionLaunchReport;
  }> {
    throwIfAborted(signal);
    const settings = getSessionOrchestrationSettings();
    const caller = getRpcSession(callerId);
    if (!caller?.isAlive()) throw new SessionOrchestrationError("The calling session is no longer available");

    const cwd = input.cwd ?? caller.cwd;
    if (!cwd || !existsSync(cwd)) {
      throw new SessionOrchestrationError(`Directory does not exist: ${input.cwd ?? caller.cwd}`);
    }
    const [callerProjectRoot, targetProjectRoot] = await Promise.all([projectRootOf(caller.cwd), projectRootOf(cwd)]);
    if (!callerProjectRoot || !targetProjectRoot || !sameProjectRoot(callerProjectRoot, targetProjectRoot)) {
      throw new SessionOrchestrationError(CROSS_PROJECT_REFUSAL);
    }
    if (this.agentSessionLoad() >= settings.maxRunning) {
      throw new SessionOrchestrationError(runningLimitRefusal(settings.maxRunning));
    }

    const model = input.model ?? settings.model ?? sessionModel(caller);
    const thinkingLevel = input.thinkingLevel ?? settings.thinkingLevel ?? sessionThinkingLevel(caller);
    const name = input.name?.trim();
    const launched = await this.launchDelegate(callerId, {
      cwd,
      toolNames: caller.inner.getActiveToolNames(),
      ...(model ? { provider: model.provider, modelId: model.modelId } : {}),
      ...(thinkingLevel ? { thinkingLevel } : {}),
      ...(name ? { name } : {}),
      firstMessage: { text: input.message, source: this.callerSource(callerId) },
    });

    const launchModel = sessionModel(launched.session);
    const launchThinking = sessionThinkingLevel(launched.session);
    const launch: SessionLaunchReport = {
      ...(launchModel ? { model: launchModel } : {}),
      ...(launchThinking ? { thinkingLevel: launchThinking } : {}),
      cwd: launched.session.cwd || cwd,
    };

    throwIfAborted(signal);
    const wait = input.wait
      ? await this.waitOn(callerId, launched.sessionId, input.timeoutSeconds, launched.turn, signal)
      : undefined;
    return {
      sessionId: launched.sessionId,
      ...(name ? { name } : {}),
      status: liveStatusOf(launched.sessionId),
      ...(wait ? { wait } : {}),
      launch,
    };
  }

  async prompt(
    callerId: string,
    input: { sessionId: string; message: string; wait?: boolean; timeoutSeconds?: number },
    signal?: AbortSignal,
  ): Promise<{ sessionId: string; status: SessionLiveStatus | "idle"; wait?: SessionWaitResult }> {
    throwIfAborted(signal);
    if (input.sessionId === callerId) throw new SessionOrchestrationError(SELF_TARGET_REFUSAL);
    await this.assertSameProject(callerId, input.sessionId);
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
    const wait = input.wait
      ? await this.waitOn(callerId, input.sessionId, input.timeoutSeconds, turn, signal)
      : undefined;
    return {
      sessionId: input.sessionId,
      status: liveStatusOf(input.sessionId),
      ...(wait ? { wait } : {}),
    };
  }

  async wait(
    callerId: string,
    sessionId: string,
    timeoutSeconds: number | undefined,
    signal?: AbortSignal,
  ): Promise<SessionWaitResult> {
    await this.assertSameProject(callerId, sessionId);
    return this.waitOn(callerId, sessionId, timeoutSeconds, undefined, signal);
  }

  async list(callerId: string, input: { limit?: number }): Promise<{ sessions: SessionToolView[] }> {
    const callerProjectRoot = await projectRootOf(getRpcSession(callerId)?.cwd);
    return listSessionViews({ callerId, callerProjectRoot, ...input });
  }

  async read(callerId: string, sessionId: string): Promise<SessionReadView> {
    await this.assertSameProject(callerId, sessionId);
    return readSessionView(sessionId);
  }

  async stop(callerId: string, sessionId: string): Promise<{ sessionId: string; status: SessionLiveStatus | "idle" }> {
    await this.assertSameProject(callerId, sessionId);
    this.requireOwnedSession(callerId, sessionId, "stopped");
    const target = getRpcSession(sessionId);
    target?.queuedTurns.cancelFrom(callerId);
    if (!target?.isAlive()) return { sessionId, status: "idle" };
    await target.send({ type: "abort" });
    return { sessionId, status: liveStatusOf(sessionId) };
  }

  async close(callerId: string, sessionId: string): Promise<{ sessionId: string; status: "closed" }> {
    await this.assertSameProject(callerId, sessionId);
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
    timeoutSeconds: number | undefined,
    turn: Promise<OrchestratedTurnOutcome> | undefined,
    signal: AbortSignal | undefined,
  ): Promise<SessionWaitResult> {
    const release = openSessionWait(callerId, targetSessionId);
    try {
      return await waitForSessionOutcome({
        sessionId: targetSessionId,
        timeoutMs: this.waitTimeoutMs(timeoutSeconds),
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

  private waitTimeoutMs(timeoutSeconds: number | undefined): number {
    return (
      clampNumber(
        timeoutSeconds,
        SESSION_ORCHESTRATION_LIMITS.waitDefaultSeconds,
        0,
        SESSION_ORCHESTRATION_LIMITS.waitMaxSeconds,
      ) * 1_000
    );
  }

  private async assertSameProject(callerId: string, sessionId: string): Promise<void> {
    const callerCwd = getRpcSession(callerId)?.cwd;
    const targetCwd = await sessionCwd(sessionId);
    if (!callerCwd) throw new SessionOrchestrationError("The calling session is no longer available");
    if (!targetCwd) throw new SessionOrchestrationError(`Session ${sessionId} was not found`);
    const [callerRoot, targetRoot] = await Promise.all([projectRootOf(callerCwd), projectRootOf(targetCwd)]);
    if (!callerRoot || !targetRoot || !sameProjectRoot(callerRoot, targetRoot)) {
      throw new SessionOrchestrationError(FOREIGN_PROJECT_REFUSAL);
    }
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

function sessionModel(caller: AgentSessionWrapper): SessionModelRef | undefined {
  const model = caller.inner.model;
  return model ? { provider: model.provider, modelId: model.id } : undefined;
}

function sessionThinkingLevel(caller: AgentSessionWrapper): string | undefined {
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
