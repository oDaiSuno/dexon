import { randomUUID } from "node:crypto";
import { SessionManager, createAgentSessionServices, getAgentDir } from "@earendil-works/pi-coding-agent";
import type { RpcServer } from "../contract/rpc";
import { RpcError } from "../contract/types";
import { readPromptIntent, titleSourceOf, type TitleSource } from "../shared/prompt-intent";
import type { SessionModelRef } from "../shared/session-orchestration";
import { validateExistingDirectory } from "./file-access-core";
import { getRpcSession } from "./rpc-manager";
import { invalidateSessionContent } from "./session-content-cache";
import { reachableModels, type AvailableModel } from "./session-model";
import { chosenModelView } from "./session-orchestration/model-view";
import { emitIndexedSessionChange, firstPromptRaw, resolveSessionPath } from "./session-reader";
import { openSessionSource } from "./session-source";
import { resolveSessionWorkspace } from "./workspace/session-binding.ts";
import {
  AUTO_TITLE_ATTEMPT_TIMEOUT_MS,
  AUTO_TITLE_MAX_LENGTH,
  AUTO_TITLE_TIMEOUT_MS,
  messageContentText,
  planNamingModels,
  sanitizeGeneratedTitle,
  titlePromptText,
} from "./session-title";

export type NamingRequest =
  | { trigger: "first-prompt"; sessionId: string; source: TitleSource | null; preference: SessionModelRef | null }
  | { trigger: "regenerate"; sessionId: string; preference: SessionModelRef | null };

export function parseNamingRequest(params: unknown): NamingRequest {
  const body = params as { sessionId?: unknown; trigger?: unknown; prompt?: unknown; namingModel?: unknown } | null;
  if (!body || typeof body.sessionId !== "string" || !body.sessionId.trim()) {
    throw new RpcError({ code: "BAD_REQUEST", message: "sessionId is required" });
  }
  const model = body.namingModel as { provider?: unknown; modelId?: unknown } | null;
  const preference =
    model &&
    typeof model.provider === "string" &&
    model.provider.trim() &&
    typeof model.modelId === "string" &&
    model.modelId.trim()
      ? { provider: model.provider, modelId: model.modelId }
      : null;
  if (body.trigger === "regenerate") {
    return { trigger: "regenerate", sessionId: body.sessionId, preference };
  }
  if (body.trigger !== "first-prompt") {
    throw new RpcError({ code: "BAD_REQUEST", message: "A naming trigger is required" });
  }
  if (typeof body.prompt !== "string") {
    throw new RpcError({ code: "BAD_REQUEST", message: "prompt is required" });
  }
  return {
    trigger: "first-prompt",
    sessionId: body.sessionId,
    source: titleSourceOf(readPromptIntent(body.prompt)),
    preference,
  };
}

const AUTO_TITLE_MAX_TOKENS = 60;
const AUTO_TITLE_SYSTEM_PROMPT =
  "You create a concise session title from the user's first message. " +
  "Rules: match the language of the message; return only a short noun phrase " +
  `of at most ${AUTO_TITLE_MAX_LENGTH} characters; no quotes, no trailing punctuation, no Markdown. ` +
  "A trailing (Skill: …) line is context, not the topic.";

type TitleSessionServices = Awaited<ReturnType<typeof createAgentSessionServices>>;
type TitleModelServices = Pick<TitleSessionServices, "modelRuntime" | "settingsManager">;
type TitleSessionTarget = { cwd: string; services?: TitleModelServices };

async function firstTitle(
  services: TitleModelServices,
  plan: readonly AvailableModel[],
  promptText: string,
): Promise<string | null> {
  const totalSignal = AbortSignal.timeout(AUTO_TITLE_TIMEOUT_MS);
  for (const model of plan) {
    if (totalSignal.aborted) break;
    try {
      const assistant = await services.modelRuntime.completeSimple(
        model,
        {
          systemPrompt: AUTO_TITLE_SYSTEM_PROMPT,
          messages: [{ role: "user", content: promptText, timestamp: Date.now() }],
        },
        {
          cacheRetention: "none",
          maxTokens: AUTO_TITLE_MAX_TOKENS,
          sessionId: randomUUID(),
          signal: AbortSignal.any([totalSignal, AbortSignal.timeout(AUTO_TITLE_ATTEMPT_TIMEOUT_MS)]),
        },
      );
      if (assistant.stopReason === "error" || assistant.stopReason === "aborted") continue;
      const title = sanitizeGeneratedTitle(messageContentText(assistant.content));
      if (title) return title;
    } catch {
      continue;
    }
  }
  return null;
}

async function hasSessionName(sessionId: string): Promise<boolean> {
  const existing = getRpcSession(sessionId);
  if (existing?.isAlive()) {
    const name = existing.inner.sessionName;
    return typeof name === "string" && name.trim().length > 0;
  }
  const filePath = await resolveSessionPath(sessionId);
  if (!filePath) return false;
  const name = SessionManager.open(filePath, undefined).getSessionName();
  return typeof name === "string" && name.trim().length > 0;
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
  return setLiveSessionName(sessionId, name);
}

async function writeSessionName(sessionId: string, name: string, options: { onlyIfEmpty: boolean }): Promise<boolean> {
  const normalized = name.trim();
  if (!normalized) return false;

  const writeIfLive = () =>
    options.onlyIfEmpty
      ? applyLiveSessionNameIfEmpty(sessionId, normalized)
      : setLiveSessionName(sessionId, normalized);

  const liveBeforePathLookup = writeIfLive();
  if (liveBeforePathLookup !== null) return liveBeforePathLookup;

  const filePath = await resolveSessionPath(sessionId);
  if (!filePath) return false;

  const liveAfterPathLookup = writeIfLive();
  if (liveAfterPathLookup !== null) return liveAfterPathLookup;

  const manager = SessionManager.open(filePath, undefined);
  if (options.onlyIfEmpty && Boolean(manager.getSessionName()?.trim())) return false;
  manager.appendSessionInfo(normalized);
  invalidateSessionContent(filePath);
  return true;
}

export async function applySessionName(sessionId: string, name: string): Promise<boolean> {
  return writeSessionName(sessionId, name, { onlyIfEmpty: false });
}

export async function applySessionNameIfEmpty(sessionId: string, name: string): Promise<boolean> {
  return writeSessionName(sessionId, name, { onlyIfEmpty: true });
}

async function resolveTitleSessionTarget(sessionId: string): Promise<TitleSessionTarget | null> {
  const existing = getRpcSession(sessionId);
  if (existing?.isAlive()) {
    const sm = existing.inner.sessionManager as unknown as Parameters<typeof resolveSessionWorkspace>[0];
    const binding = resolveSessionWorkspace(sm as never);
    if (binding.kind === "ssh") {
      return {
        cwd: binding.workspace,
        services: {
          modelRuntime: existing.inner.modelRuntime as unknown as TitleSessionServices["modelRuntime"],
          settingsManager: existing.inner.settingsManager,
        },
      };
    }
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
  const manager = SessionManager.open(filePath, undefined);
  const binding = resolveSessionWorkspace(manager);
  if (binding.kind === "ssh") return { cwd: binding.workspace };
  const cwd = manager.getHeader()?.cwd;
  const dir = validateExistingDirectory(cwd);
  return dir.ok ? { cwd: dir.path } : null;
}

function settingsDefaultRef(settings: TitleModelServices["settingsManager"]): SessionModelRef | null {
  const provider = settings.getDefaultProvider();
  const modelId = settings.getDefaultModel();
  return provider && modelId ? { provider, modelId } : null;
}

export async function nameSession(server: RpcServer, request: NamingRequest): Promise<string | null> {
  try {
    const { sessionId } = request;
    if (request.trigger === "first-prompt" && (!request.source || (await hasSessionName(sessionId)))) return null;
    const target = await resolveTitleSessionTarget(sessionId);
    if (!target) return null;
    const source =
      request.trigger === "first-prompt"
        ? request.source
        : titleSourceOf(readPromptIntent(firstPromptRaw((await openSessionSource(sessionId))?.entries ?? [])));
    if (!source) return null;
    const services =
      target.services ?? (await createAgentSessionServices({ cwd: target.cwd, agentDir: getAgentDir() }));
    const conversation = (await chosenModelView(sessionId)).model ?? settingsDefaultRef(services.settingsManager);
    const plan = planNamingModels({
      preference: request.preference,
      conversation,
      reachable: reachableModels(services.modelRuntime),
    });
    const title = await firstTitle(services, plan, titlePromptText(source));
    if (!title) return null;
    const written =
      request.trigger === "first-prompt"
        ? await applySessionNameIfEmpty(sessionId, title)
        : await applySessionName(sessionId, title);
    if (!written) return null;
    await emitIndexedSessionChange(server, sessionId, target.cwd);
    return title;
  } catch {
    return null;
  }
}
