import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { RpcServer } from "../../contract/rpc";
import { RpcError } from "../../contract/types";
import { getRpcSession, startRpcSession } from "../rpc-manager";
import { ensureSessionEvents } from "../session-event-binding";
import { resolveSessionPath } from "../session-reader";
import { launchDesktopSession } from "../session-launcher";
import { nameSession, parseNamingRequest } from "../session-naming";

export function registerAgentHandlers(server: RpcServer): void {
  server.handle({
    "agent.new": async (params) => {
      const body = params as {
        cwd: string;
        type?: string;
        message?: string;
        provider?: string;
        modelId?: string;
        toolNames?: string[];
        thinkingLevel?: string;
        [key: string]: unknown;
      };
      const { cwd, provider, modelId, toolNames, thinkingLevel, ...rest } = body;
      const launched = await launchDesktopSession({
        cwd,
        ...(toolNames ? { toolNames } : {}),
        ...(provider && modelId ? { provider, modelId } : {}),
        ...(thinkingLevel ? { thinkingLevel } : {}),
        ...(rest.type === "ensure_session"
          ? { announceChange: false }
          : {
              command: (rest.type ? rest : { type: "prompt", message: body.message ?? "" }) as Record<string, unknown>,
            }),
      });
      return { sessionId: launched.sessionId, data: launched.data };
    },

    "agent.command": async (params) => {
      const { sessionId, command } = params as {
        sessionId: string;
        command: Record<string, unknown>;
      };
      const existing = getRpcSession(sessionId);
      if (existing?.isAlive()) {
        // Ensure event subscription
        ensureSessionEvents(server, existing, sessionId);
        return existing.send(command);
      }
      const filePath = await resolveSessionPath(sessionId);
      if (!filePath) throw new RpcError({ code: "NOT_FOUND", message: "Session not found" });
      const cwd = SessionManager.open(filePath).getHeader()?.cwd ?? process.cwd();
      const { session } = await startRpcSession(sessionId, filePath, cwd);
      ensureSessionEvents(server, session, sessionId);
      return session.send(command);
    },

    "agent.state": async (params) => {
      const { sessionId } = params as { sessionId: string };
      const session = getRpcSession(sessionId);
      if (!session || !session.isAlive()) return { running: false };
      const state = await session.send({ type: "get_state" });
      return { running: true, state };
    },

    "agent.generateTitle": async (params) => ({
      title: await nameSession(server, parseNamingRequest(params)),
    }),
  });
}
