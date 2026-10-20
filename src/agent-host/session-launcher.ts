import { existsSync } from "node:fs";
import type { RpcServer } from "../contract/rpc";
import { RpcError } from "../contract/types";
import type { SessionSourceRef } from "../shared/session-orchestration";
import { allowFileRoot } from "./file-access";
import { startRpcSession, type AgentSessionWrapper, type OrchestratedTurnOutcome } from "./rpc-manager";
import { createAgentNewLockKey, ensureSessionEvents } from "./session-event-binding";
import { emitIndexedSessionChange } from "./session-reader";
import { announceSessionOnFirstMessage } from "./session-source";

export interface DesktopSessionLaunch {
  cwd: string;
  toolNames?: string[];
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

export async function launchDesktopSession(launch: DesktopSessionLaunch): Promise<LaunchedDesktopSession> {
  const { cwd } = launch;
  if (!cwd || typeof cwd !== "string") throw new RpcError({ code: "BAD_REQUEST", message: "cwd is required" });
  if (!existsSync(cwd)) throw new RpcError({ code: "BAD_REQUEST", message: `Directory does not exist: ${cwd}` });

  const server = sessionLauncherServer();
  const { session, realSessionId } = await startRpcSession(createAgentNewLockKey(), "", cwd, launch.toolNames);
  allowFileRoot(cwd);

  ensureSessionEvents(server, session, realSessionId);
  announceSessionOnFirstMessage(server, session);

  if (launch.provider && launch.modelId) {
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
