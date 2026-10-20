import { existsSync } from "node:fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  SESSION_ORCHESTRATION_LIMITS,
  type SessionLiveStatus,
  type SessionModelRef,
  type SessionSourceRef,
} from "../../shared/session-orchestration";
import { resolveProject } from "../../shared/worktree";
import {
  getRpcSession,
  listRpcSessions,
  startRpcSession,
  subscribeSessionStatuses,
  type AgentSessionWrapper,
  type OrchestratedTurnOutcome,
} from "../rpc-manager";
import { ensureSessionEvents } from "../session-event-binding";
import { launchDesktopSession, sessionLauncherServer } from "../session-launcher";
import { getSessionOrigin, setSessionOrigin } from "../session-origin-store";
import { resolveSessionPath } from "../session-reader";
import {
  clampNumber,
  isSessionRunning,
  lastSessionReply,
  listSessionViews,
  liveStatusOf,
  readSessionView,
  type SessionReadView,
  type SessionToolView,
} from "./inspection";
import { getSessionOrchestrationSettings } from "./settings";

export type { SessionReadView, SessionToolCallSummary, SessionToolView } from "./inspection";

export type SessionWaitStatus = "idle" | "error" | "awaiting_input" | "timeout";

export interface SessionWaitResult {
  status: SessionWaitStatus;
  stillRunning: boolean;
  lastReply?: string;
  error?: string;
}

export class SessionOrchestrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionOrchestrationError";
  }
}

const CROSS_PROJECT_REFUSAL =
  "Session tools can only create sessions inside the caller's own project; that directory belongs to another project";
const CALLER_ONLY_REFUSAL = "Only sessions created by this session can be";

function callerSourceTitle(caller: AgentSessionWrapper): string | undefined {
  const name = caller.inner.sessionName;
  return typeof name === "string" && name.trim() ? name.trim() : undefined;
}

function waitForStatusBroadcast(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      off();
      if (timer !== null) clearTimeout(timer);
      resolve();
    };
    const off = subscribeSessionStatuses(finish);
    timer = setTimeout(finish, timeoutMs);
  });
}

export class SessionOrchestrationService {
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
  ): Promise<{ sessionId: string; name?: string; status: SessionLiveStatus | "idle"; wait?: SessionWaitResult }> {
    const settings = getSessionOrchestrationSettings();
    const caller = getRpcSession(callerId);
    if (!caller?.isAlive()) throw new SessionOrchestrationError("The calling session is no longer available");

    const cwd = input.cwd ?? caller.cwd;
    if (!cwd || !existsSync(cwd)) {
      throw new SessionOrchestrationError(`Directory does not exist: ${input.cwd ?? caller.cwd}`);
    }
    const [callerProject, targetProject] = await Promise.all([resolveProject(caller.cwd), resolveProject(cwd)]);
    if (callerProject.projectRoot !== targetProject.projectRoot) {
      throw new SessionOrchestrationError(CROSS_PROJECT_REFUSAL);
    }
    if (this.runningAgentSessions() >= settings.maxRunning)
      throw new SessionOrchestrationError(this.runningLimitReason());

    const model = input.model ?? settings.model ?? callerModel(caller);
    const thinkingLevel = input.thinkingLevel ?? settings.thinkingLevel ?? callerThinkingLevel(caller);
    const name = input.name?.trim();
    const launched = await launchDesktopSession({
      cwd,
      toolNames: caller.inner.getActiveToolNames(),
      ...(model ? { provider: model.provider, modelId: model.modelId } : {}),
      ...(thinkingLevel ? { thinkingLevel } : {}),
      ...(name ? { name } : {}),
      firstMessage: { text: input.message, source: this.callerSource(callerId) },
    });
    setSessionOrigin(launched.sessionId, { relation: "delegate", createdBySessionId: callerId });

    const wait = input.wait
      ? await this.waitForOutcome(launched.sessionId, this.waitTimeout(input.timeoutMs), launched.turn)
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
  ): Promise<{ sessionId: string; status: SessionLiveStatus | "idle"; wait?: SessionWaitResult }> {
    if (input.sessionId === callerId) throw new SessionOrchestrationError("A session cannot prompt itself");
    const settings = getSessionOrchestrationSettings();
    const origin = getSessionOrigin(input.sessionId);
    if (!settings.allowUserSessions && !origin?.createdBySessionId) {
      throw new SessionOrchestrationError(
        "Prompting sessions the user created is turned off in Session collaboration settings",
      );
    }

    const target = await this.requireLiveSession(input.sessionId);
    if (!target.isRunning() && origin?.createdBySessionId && this.runningAgentSessions() >= settings.maxRunning) {
      throw new SessionOrchestrationError(this.runningLimitReason());
    }

    const turn = target.runOrchestratedTurn({
      message: input.message,
      source: this.callerSource(callerId),
    });
    const wait = input.wait
      ? await this.waitForOutcome(input.sessionId, this.waitTimeout(input.timeoutMs), turn)
      : undefined;
    return {
      sessionId: input.sessionId,
      status: liveStatusOf(input.sessionId),
      ...(wait ? { wait } : {}),
    };
  }

  async wait(sessionId: string, timeoutMs: number | undefined): Promise<SessionWaitResult> {
    return this.waitForOutcome(sessionId, this.waitTimeout(timeoutMs));
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

  private runningLimitReason(): string {
    const { maxRunning } = getSessionOrchestrationSettings();
    return `At most ${maxRunning} sessions created by agents can run at once; wait for one to finish or close it`;
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

  private async waitForOutcome(
    sessionId: string,
    timeoutMs: number,
    turn?: Promise<OrchestratedTurnOutcome>,
  ): Promise<SessionWaitResult> {
    let outcome: OrchestratedTurnOutcome | undefined;
    let failure: string | undefined;
    if (turn) {
      void turn.then(
        (value) => {
          outcome = value;
        },
        (error: unknown) => {
          failure = error instanceof Error ? error.message : String(error);
        },
      );
    }

    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (failure) return { status: "error", stillRunning: isSessionRunning(sessionId), error: failure };
      if (outcome) {
        if (outcome.error) {
          return { status: "error", stillRunning: isSessionRunning(sessionId), error: outcome.error };
        }
        return {
          status: "idle",
          stillRunning: isSessionRunning(sessionId),
          ...(outcome.reply ? { lastReply: outcome.reply } : {}),
        };
      }

      const status = liveStatusOf(sessionId);
      if (status === "awaiting_input") return { status: "awaiting_input", stillRunning: true };
      if (!turn && (status === "idle" || status === "error")) {
        if (status === "error") {
          const error = getRpcSession(sessionId)?.lastTurnErrorMessage() ?? "The session's last turn failed";
          return { status: "error", stillRunning: false, error };
        }
        const lastReply = await lastSessionReply(sessionId);
        return { status: "idle", stillRunning: false, ...(lastReply ? { lastReply } : {}) };
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) return { status: "timeout", stillRunning: isSessionRunning(sessionId) };
      await waitForStatusBroadcast(Math.min(remaining, 100));
    }
  }
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

export function peekSessionOrchestrationService(): SessionOrchestrationService | null {
  return service;
}
