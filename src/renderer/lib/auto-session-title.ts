/**
 * ChatGPT-style auto session titles.
 *
 * When a brand-new session receives its first user message, we ask the Host to
 * generate a short title from that message via a silent LLM request (it never
 * enters the session's message history or context window). The Host applies the
 * title itself with an internal "already named?" guard so a manual rename
 * always wins, and falls back to a local first-N-characters title when the LLM
 * call fails — the sidebar never shows an untitled session.
 */
import { call } from "./api-client";
import { trackSessionNaming } from "./session-naming-store";

export const AUTO_TITLE_STORAGE_KEY = "dexon:autoSessionTitle";
export const SESSION_NAMING_MODEL_STORAGE_KEY = "dexon:sessionNamingModel";
export const AUTO_TITLE_MIN_MESSAGE_LENGTH = 2;

export interface SessionNamingModel {
  provider: string;
  modelId: string;
}

function readEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(AUTO_TITLE_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

/** Whether the "Auto-title new sessions" setting is enabled (default: on). */
export function isAutoSessionTitleEnabled(): boolean {
  return readEnabled();
}

export function setAutoSessionTitleEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (enabled) window.localStorage.removeItem(AUTO_TITLE_STORAGE_KEY);
    else window.localStorage.setItem(AUTO_TITLE_STORAGE_KEY, "off");
  } catch {
    /* localStorage unavailable — keep the default behavior */
  }
}

export function getSessionNamingModel(): SessionNamingModel | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SESSION_NAMING_MODEL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { provider?: unknown; modelId?: unknown };
    const { provider, modelId } = parsed ?? {};
    if (typeof provider !== "string" || typeof modelId !== "string") return null;
    if (!provider || !modelId) return null;
    return { provider, modelId };
  } catch {
    return null;
  }
}

export function setSessionNamingModel(model: SessionNamingModel | null): void {
  if (typeof window === "undefined") return;
  try {
    if (model) {
      window.localStorage.setItem(
        SESSION_NAMING_MODEL_STORAGE_KEY,
        JSON.stringify({ provider: model.provider, modelId: model.modelId }),
      );
    } else {
      window.localStorage.removeItem(SESSION_NAMING_MODEL_STORAGE_KEY);
    }
  } catch {
    return;
  }
}

/**
 * A new-session first message qualifies when auto-titles are on and the message
 * is real text — not a slash command and long enough to summarize.
 */
export function shouldAutoTitleMessage(message: string): boolean {
  if (!isAutoSessionTitleEnabled()) return false;
  const trimmed = message.trim();
  if (!trimmed || trimmed.startsWith("/")) return false;
  if ([...trimmed].length < AUTO_TITLE_MIN_MESSAGE_LENGTH) return false;
  return true;
}

export interface AutoSessionTitleOptions {
  sessionId: string;
  message: string;
  provider?: string;
  modelId?: string;
}

/**
 * Fire the silent title request; the Host generates and applies the title with
 * its own rename guard. Never throws: all failures (model unavailable, timeout,
 * session gone) are swallowed because the auto title is best-effort and must
 * never interrupt the conversation.
 */
export async function requestAutoSessionTitle(options: AutoSessionTitleOptions): Promise<string | null> {
  try {
    const model =
      getSessionNamingModel() ??
      (options.provider && options.modelId ? { provider: options.provider, modelId: options.modelId } : null);
    const result = await call("agent.generateTitle", {
      sessionId: options.sessionId,
      message: options.message,
      ...(model ? { provider: model.provider, modelId: model.modelId } : {}),
    });
    return result.title;
  } catch {
    return null;
  }
}

export async function regenerateSessionTitle(sessionId: string, message: string): Promise<string | null> {
  const model = getSessionNamingModel();
  if (!model) return null;
  return trackSessionNaming(sessionId, async () => {
    try {
      const result = await call("agent.generateTitle", {
        sessionId,
        message,
        provider: model.provider,
        modelId: model.modelId,
        replace: true,
      });
      return result.title;
    } catch {
      return null;
    }
  });
}
