import type { AgentMessage, UserMessage } from "@/lib/types";
import { promptIntentText, readPromptIntent } from "@shared/prompt-intent";

export interface RecallablePrompt {
  readonly text: string;
  readonly at: number | null;
}

export function composerPromptText(message: UserMessage): string | null {
  if (message.channelSource || message.sessionSource || message.syntheticSource) return null;
  if (Array.isArray(message.content) && message.content.some((block) => block.deferredContent)) return null;
  const raw =
    typeof message.content === "string"
      ? message.content
      : message.content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("\n");
  const text = raw.trim();
  if (!text) return null;
  const intent = readPromptIntent(text);
  const prompt = promptIntentText(intent);
  return intent.kind === "skill" && !intent.goal ? `${prompt} ` : prompt;
}

export function recallablePrompts(messages: readonly AgentMessage[]): readonly RecallablePrompt[] {
  return messages.flatMap((message) => {
    if (message.role !== "user") return [];
    const text = composerPromptText(message);
    return text === null ? [] : [{ text, at: message.timestamp ?? null }];
  });
}

declare const promptHistoryBrand: unique symbol;
export type PromptHistory = readonly [string, ...string[]] & {
  readonly [promptHistoryBrand]: true;
};

export const PROMPT_HISTORY_LIMIT = 100;
const localCommands = new Map<string, readonly RecallablePrompt[]>();

export function recordLocalCommand(scopeKey: string, text: string, at: number): void {
  const prompt = text.trim();
  if (!prompt) return;
  localCommands.set(scopeKey, [...localCommandsFor(scopeKey), { text: prompt, at }].slice(-PROMPT_HISTORY_LIMIT));
}

export function localCommandsFor(scopeKey: string): readonly RecallablePrompt[] {
  return localCommands.get(scopeKey) ?? [];
}

function comparePromptTime(a: RecallablePrompt, b: RecallablePrompt): number {
  if (a.at === b.at) return 0;
  if (a.at === null) return -1;
  if (b.at === null) return 1;
  return a.at - b.at;
}

export function carryLocalCommands(fromScopeKey: string, toScopeKey: string): void {
  if (fromScopeKey === toScopeKey) return;
  const carried = localCommandsFor(fromScopeKey);
  if (!carried.length) return;
  localCommands.set(
    toScopeKey,
    [...carried, ...localCommandsFor(toScopeKey)].sort(comparePromptTime).slice(-PROMPT_HISTORY_LIMIT),
  );
  localCommands.delete(fromScopeKey);
}

export function buildPromptHistory(
  transcript: readonly RecallablePrompt[],
  local: readonly RecallablePrompt[],
): PromptHistory | null {
  const merged = [...transcript, ...local].sort(comparePromptTime);
  const prompts: string[] = [];
  for (const prompt of merged.reverse()) {
    if (prompt.text === prompts.at(-1)) continue;
    prompts.push(prompt.text);
    if (prompts.length === PROMPT_HISTORY_LIMIT) break;
  }
  return prompts.length ? (Object.freeze(prompts) as PromptHistory) : null;
}
