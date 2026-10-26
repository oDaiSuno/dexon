import { randomUUID } from "crypto";
import {
  SessionManager,
  createAgentSessionServices,
  getAgentDir,
  type ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import type { RpcServer } from "../../contract/rpc";
import { RpcError } from "../../contract/types";
import { validateExistingDirectory } from "../file-access-core";
import { getRpcSession, startRpcSession } from "../rpc-manager";
import { ensureSessionEvents } from "../session-event-binding";
import { emitIndexedSessionChange, resolveSessionPath } from "../session-reader";
import { invalidateSessionContent } from "../session-content-cache";
import { launchDesktopSession } from "../session-launcher";
import {
  AUTO_TITLE_MAX_LENGTH,
  makeFallbackTitle,
  messageContentText,
  sanitizeGeneratedTitle,
  takeCodePoints,
} from "../session-title";

// ============================================================================
// Auto session title — silent LLM request that never touches session history.
// ============================================================================

const AUTO_TITLE_REQUEST_MAX_CHARS = 2000;
const AUTO_TITLE_MAX_TOKENS = 60;
const AUTO_TITLE_TIMEOUT_MS = 15_000;
const AUTO_TITLE_SYSTEM_PROMPT =
  "You create a concise session title from the user's first message. " +
  "Rules: match the language of the message; return only a short noun phrase " +
  `of at most ${AUTO_TITLE_MAX_LENGTH} characters; no quotes, no trailing punctuation, no Markdown.`;

type TitleSessionServices = Awaited<ReturnType<typeof createAgentSessionServices>>;
type TitleModelServices = Pick<TitleSessionServices, "modelRuntime" | "settingsManager">;

type AvailableModel = Awaited<ReturnType<ModelRuntime["getAvailable"]>>[number];

function resolveTitleModel(
  services: TitleModelServices,
  provider?: string,
  modelId?: string,
): AvailableModel | undefined {
  const runtime = services.modelRuntime;
  if (provider && modelId) {
    const byRef = runtime.getModel(provider, modelId);
    if (byRef) return byRef as AvailableModel;
  }
  const settings = services.settingsManager;
  const defaultProvider = settings.getDefaultProvider();
  const defaultModelId = settings.getDefaultModel();
  if (defaultProvider && defaultModelId) {
    const byDefault = runtime.getModel(defaultProvider, defaultModelId);
    if (byDefault) return byDefault as AvailableModel;
  }
  return runtime.getAvailableSnapshot()[0];
}

async function generateSessionTitle(
  services: TitleModelServices,
  message: string,
  provider?: string,
  modelId?: string,
): Promise<string | null> {
  const model = resolveTitleModel(services, provider, modelId);
  if (!model) return null;
  try {
    const assistant = await services.modelRuntime.completeSimple(
      model,
      {
        systemPrompt: AUTO_TITLE_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: takeCodePoints(message, AUTO_TITLE_REQUEST_MAX_CHARS),
            timestamp: Date.now(),
          },
        ],
      },
      {
        // Standalone request: never reuse or write prompt-cache entries.
        cacheRetention: "none",
        maxTokens: AUTO_TITLE_MAX_TOKENS,
        sessionId: randomUUID(),
        signal: AbortSignal.timeout(AUTO_TITLE_TIMEOUT_MS),
      },
    );
    return sanitizeGeneratedTitle(messageContentText(assistant.content));
  } catch {
    return null;
  }
}

async function generateSessionTitleOrNull(
  createServices: () => Promise<TitleModelServices>,
  message: string,
  provider?: string,
  modelId?: string,
): Promise<string | null> {
  try {
    const services = await createServices();
    return await generateSessionTitle(services, message, provider, modelId);
  } catch {
    return null;
  }
}

export async function generateSessionTitleWithFallback(
  createServices: () => Promise<TitleModelServices>,
  message: string,
  provider?: string,
  modelId?: string,
): Promise<string> {
  return (await generateSessionTitleOrNull(createServices, message, provider, modelId)) ?? makeFallbackTitle(message);
}

async function hasSessionName(sessionId: string): Promise<boolean> {
  const existing = getRpcSession(sessionId);
  if (existing?.isAlive()) {
    const name = existing.inner.sessionName;
    return typeof name === "string" && name.trim().length > 0;
  }
  try {
    const filePath = await resolveSessionPath(sessionId);
    if (!filePath) return false;
    const storedName = SessionManager.open(filePath, undefined).getSessionName();
    return typeof storedName === "string" && storedName.trim().length > 0;
  } catch {
    return false;
  }
}

function setLiveSessionName(sessionId: string, name: string): boolean | null {
  const existing = getRpcSession(sessionId);
  if (!existing?.isAlive()) return null;
  existing.inner.setSessionName(name);
  return true;
}

function applyLiveSessionNameIfEmpty(sessionId: string, name: string): boolean | null {
  const existing = getRpcSession(sessionId);
  if (!existing?.isAlive()) return null;
  const currentName = existing.inner.sessionName;
  if (typeof currentName === "string" && currentName.trim().length > 0) return false;

  // Keep the check and write in the same synchronous turn. A manual rename
  // that ran first is observed above; one that runs later overwrites this
  // automatic value, so the manual choice always wins.
  return setLiveSessionName(sessionId, name);
}

export async function applySessionName(sessionId: string, name: string): Promise<boolean> {
  const normalized = name.trim();
  if (!normalized) return false;

  const liveResult = setLiveSessionName(sessionId, normalized);
  if (liveResult !== null) return liveResult;

  const filePath = await resolveSessionPath(sessionId);
  if (!filePath) return false;

  const liveResultAfterLookup = setLiveSessionName(sessionId, normalized);
  if (liveResultAfterLookup !== null) return liveResultAfterLookup;

  SessionManager.open(filePath, undefined).appendSessionInfo(normalized);
  invalidateSessionContent(filePath);
  return true;
}

export async function applySessionNameIfEmpty(sessionId: string, name: string): Promise<boolean> {
  const normalized = name.trim();
  if (!normalized) return false;

  const liveResult = applyLiveSessionNameIfEmpty(sessionId, normalized);
  if (liveResult !== null) return liveResult;

  const filePath = await resolveSessionPath(sessionId);
  if (!filePath) return false;

  // The session may have become live while its path was resolving.
  const liveResultAfterLookup = applyLiveSessionNameIfEmpty(sessionId, normalized);
  if (liveResultAfterLookup !== null) return liveResultAfterLookup;

  const manager = SessionManager.open(filePath, undefined);
  const storedName = manager.getSessionName();
  if (typeof storedName === "string" && storedName.trim().length > 0) return false;

  // SessionManager's read and append are synchronous, so another Renderer RPC
  // cannot interleave a manual rename between this final check and the write.
  manager.appendSessionInfo(normalized);
  invalidateSessionContent(filePath);
  return true;
}

async function resolveTitleSessionTarget(
  sessionId: string,
): Promise<{ cwd: string; services?: TitleModelServices } | null> {
  const existing = getRpcSession(sessionId);
  if (existing?.isAlive()) {
    const dir = validateExistingDirectory(existing.cwd);
    if (!dir.ok) return null;
    return {
      cwd: dir.path,
      services: {
        modelRuntime: existing.inner.modelRuntime as unknown as TitleSessionServices["modelRuntime"],
        settingsManager: existing.inner.settingsManager,
      },
    };
  }

  const filePath = await resolveSessionPath(sessionId);
  if (!filePath) return null;
  const cwd = SessionManager.open(filePath, undefined).getHeader()?.cwd;
  const dir = validateExistingDirectory(cwd);
  return dir.ok ? { cwd: dir.path } : null;
}

function titleServices(target: { cwd: string; services?: TitleModelServices }): () => Promise<TitleModelServices> {
  return target.services
    ? async () => target.services as TitleModelServices
    : () => createAgentSessionServices({ cwd: target.cwd, agentDir: getAgentDir() });
}

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

    "agent.generateTitle": async (params) => {
      const body = params as {
        sessionId: string;
        message: string;
        provider?: string;
        modelId?: string;
        replace?: boolean;
      };
      const { sessionId, message } = body;
      if (typeof sessionId !== "string" || !sessionId) {
        throw new RpcError({ code: "BAD_REQUEST", message: "sessionId is required" });
      }
      if (typeof message !== "string" || !message.trim()) {
        throw new RpcError({ code: "BAD_REQUEST", message: "message is required" });
      }
      const target = await resolveTitleSessionTarget(sessionId);
      if (!target) return { title: null };

      if (body.replace === true) {
        const title = await generateSessionTitleOrNull(titleServices(target), message, body.provider, body.modelId);
        if (!title || !(await applySessionName(sessionId, title))) return { title: null };
        await emitIndexedSessionChange(server, sessionId, target.cwd);
        return { title };
      }

      if (await hasSessionName(sessionId)) return { title: null };

      const finalTitle = await generateSessionTitleWithFallback(
        titleServices(target),
        message,
        body.provider,
        body.modelId,
      );

      if (!(await applySessionNameIfEmpty(sessionId, finalTitle))) return { title: null };

      await emitIndexedSessionChange(server, sessionId, target.cwd);
      return { title: finalTitle };
    },
  });
}
