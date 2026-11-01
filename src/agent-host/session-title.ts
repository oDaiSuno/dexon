import type { TitleSource } from "../shared/prompt-intent";
import type { SessionModelRef } from "../shared/session-orchestration";

export const AUTO_TITLE_MAX_LENGTH = 40;
export const AUTO_TITLE_REQUEST_MAX_CHARS = 2000;
export const AUTO_TITLE_TIMEOUT_MS = 15_000;
export const AUTO_TITLE_ATTEMPT_TIMEOUT_MS = 5_000;

export function titlePromptText(source: TitleSource): string {
  const hint = source.skill ? `\n\n(Skill: ${source.skill})` : "";
  return takeCodePoints(source.goal, AUTO_TITLE_REQUEST_MAX_CHARS - [...hint].length) + hint;
}

export function planNamingModels<T extends { provider: string; id: string }>(input: {
  preference: SessionModelRef | null;
  conversation: SessionModelRef | null;
  reachable: readonly T[];
}): readonly T[] {
  const plan: T[] = [];
  for (const ref of [input.preference, input.conversation]) {
    if (!ref || plan.some((model) => model.provider === ref.provider && model.id === ref.modelId)) continue;
    const model = input.reachable.find((model) => model.provider === ref.provider && model.id === ref.modelId);
    if (model) plan.push(model);
  }
  return plan;
}

export function takeCodePoints(value: string, max: number): string {
  return [...value].slice(0, max).join("");
}

/**
 * Normalize a model-generated title: collapse whitespace/newlines, strip
 * wrapping quotes/brackets, remove trailing punctuation, cap at
 * {@link AUTO_TITLE_MAX_LENGTH} characters. Returns null when nothing usable
 * remains.
 */
export function sanitizeGeneratedTitle(raw: string): string | null {
  const collapsed = raw
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const stripped = collapsed.replace(/^['"“”‘’「」『』]+|['"“”‘’「」『』]+$/g, "");
  const trimmed = stripped.replace(/[.。!！?？:：;；,\s]+$/u, "").trim();
  if (!trimmed) return null;
  return takeCodePoints(trimmed, AUTO_TITLE_MAX_LENGTH);
}

/**
 * Extract plain text from an assistant message's content blocks (text,
 * thinking, tool calls) without depending on SDK text helpers.
 */
export function messageContentText(content: unknown): string {
  const pushText = (item: unknown) => {
    if (typeof item === "string") {
      return item;
    }
    if (item && typeof item === "object") {
      const text = (item as { text?: unknown }).text;
      if (typeof text === "string") return text;
    }
    return null;
  };
  if (Array.isArray(content)) {
    return content
      .map(pushText)
      .filter((part): part is string => part !== null)
      .join(" ");
  }
  return pushText(content) ?? "";
}
