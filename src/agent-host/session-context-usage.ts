/**
 * Reconstruct context-window usage from a persisted session file.
 *
 * Live agent sessions report authoritative usage through get_state (pi's
 * AgentSession.getContextUsage()). Sessions without a live runtime — evicted
 * after the idle timeout, or after an app restart — previously had no way to
 * answer "how full is the context window?" without sending a new message.
 * This module mirrors pi's own computation over the session file so reopening
 * a session restores the statistic, without starting an agent or performing
 * any network request.
 */
import { calculateContextTokens, estimateTokens, getLatestCompactionEntry } from "@earendil-works/pi-coding-agent";

export interface ContextUsageSnapshot {
  percent: number | null;
  contextWindow: number;
  tokens: number | null;
}

interface UsageLike {
  totalTokens?: number;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

interface AssistantLike {
  role?: unknown;
  stopReason?: unknown;
  usage?: UsageLike;
}

interface BranchEntryLike {
  type?: unknown;
  message?: AssistantLike;
}

export interface SessionContextUsageSource {
  /** Resolved LLM context messages (SessionManager.buildSessionContext().messages). */
  messages: unknown[];
  /** Raw entries on the active branch (SessionManager.getBranch()). */
  branchEntries: unknown[];
  /** Context window of the model this session used; unknown when unresolvable. */
  contextWindow: number | null | undefined;
}

interface SessionManagerLike {
  buildSessionContext(): { messages: unknown[]; model: { provider: string; modelId: string } | null };
  getBranch(fromId?: string): unknown[];
}

/** Identical arithmetic to pi's calculateContextTokens, tolerant of partial usage. */
function usageTokenCount(usage: UsageLike | undefined): number {
  if (!usage) return 0;
  const normalized = {
    ...usage,
    input: usage.input ?? 0,
    output: usage.output ?? 0,
    cacheRead: usage.cacheRead ?? 0,
    cacheWrite: usage.cacheWrite ?? 0,
  } as Parameters<typeof calculateContextTokens>[0];
  return calculateContextTokens(normalized);
}

function hasValidAssistantUsage(message: AssistantLike | undefined): message is AssistantLike & { usage: UsageLike } {
  if (!message || message.role !== "assistant") return false;
  if (message.stopReason === "aborted" || message.stopReason === "error") return false;
  return usageTokenCount(message.usage) > 0;
}

function estimateMessageTokens(message: unknown): number {
  return estimateTokens(message as Parameters<typeof estimateTokens>[0]);
}

/**
 * Mirrors pi's private estimateContextTokens(): trust the last valid assistant
 * usage as the context size at that point, then estimate tokens for messages
 * appended after it. Without any usage, fall back to estimating every message.
 */
function estimateContextTokensFromMessages(messages: unknown[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as AssistantLike | undefined;
    if (!hasValidAssistantUsage(message)) continue;
    let trailing = 0;
    for (let tail = index + 1; tail < messages.length; tail += 1) trailing += estimateMessageTokens(messages[tail]);
    return usageTokenCount(message.usage) + trailing;
  }
  let estimated = 0;
  for (const message of messages) estimated += estimateMessageTokens(message);
  return estimated;
}

export function computeSessionContextUsage(source: SessionContextUsageSource): ContextUsageSnapshot | null {
  const contextWindow = source.contextWindow ?? 0;
  if (!(contextWindow > 0)) return null;

  // Mirrors pi's AgentSession.getContextUsage(): after a compaction, the last
  // assistant usage reflects the pre-compaction context size, so the token
  // count stays unknown until an assistant responds after the boundary.
  const branchEntries = source.branchEntries as BranchEntryLike[];
  const latestCompaction = getLatestCompactionEntry(
    source.branchEntries as Parameters<typeof getLatestCompactionEntry>[0],
  );
  if (latestCompaction) {
    const compactionIndex = branchEntries.lastIndexOf(latestCompaction as BranchEntryLike);
    let hasPostCompactionUsage = false;
    for (let index = branchEntries.length - 1; index > compactionIndex; index -= 1) {
      if (hasValidAssistantUsage(branchEntries[index]?.message)) {
        hasPostCompactionUsage = true;
        break;
      }
    }
    if (!hasPostCompactionUsage) return { tokens: null, contextWindow, percent: null };
  }

  const tokens = estimateContextTokensFromMessages(source.messages);
  return { tokens, contextWindow, percent: (tokens / contextWindow) * 100 };
}

/**
 * Full reconstruction for one session snapshot: resolve the context window of
 * the model the session used, then compute usage over the active branch.
 * Returns null when the model (or its context window) cannot be determined.
 */
export async function reconstructSessionContextUsage(options: {
  manager: SessionManagerLike;
  resolveContextWindow: (model: { provider: string; modelId: string } | null) => Promise<number | null | undefined>;
}): Promise<ContextUsageSnapshot | null> {
  const context = options.manager.buildSessionContext();
  const contextWindow = await options.resolveContextWindow(context.model ?? null);
  return computeSessionContextUsage({
    messages: context.messages,
    branchEntries: options.manager.getBranch(),
    contextWindow,
  });
}
