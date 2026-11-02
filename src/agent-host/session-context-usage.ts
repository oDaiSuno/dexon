import {
  buildSessionProjection,
  calculateContextTokens,
  estimateTokens,
  getLatestCompactionEntry,
} from "@earendil-works/pi-coding-agent";
import { getCurrentSystemMessage, getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai";
import type { AgentMessage, PersistedMessage } from "../shared/types";
import { toDisplayMessage } from "./display-message";
import type { ContextUsageBreakdown, ContextUsageInfo } from "../contract/types";
import type { SessionModelRef } from "../shared/session-orchestration";
import type { SessionBranch } from "./session-branch";

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
  messages: unknown[];
  branchEntries: readonly unknown[];
  contextWindow: number | null | undefined;
}

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

function estimateContextTokensFromMessages(messages: unknown[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as AssistantLike | undefined;
    if (!hasValidAssistantUsage(message)) continue;
    let trailing = 0;
    for (let tail = index + 1; tail < messages.length; tail += 1) trailing += estimateMessageTokens(messages[tail]);
    return usageTokenCount(message.usage) + trailing;
  }
  const currentSystem = getCurrentSystemMessage(messages as PersistedMessage[]);
  let estimated = currentSystem ? estimateMessageTokens(currentSystem) : 0;
  for (const message of messages) {
    if ((message as { role: string }).role !== "system") estimated += estimateMessageTokens(message);
  }
  return estimated;
}

export function computeSessionContextUsage(source: SessionContextUsageSource): ContextUsageSnapshot | null {
  const contextWindow = source.contextWindow ?? 0;
  if (!(contextWindow > 0)) return null;

  const branchEntries = source.branchEntries as readonly BranchEntryLike[];
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

export async function describeStoredContextUsage(options: {
  branch: SessionBranch;
  profile?: ContextProfile;
  resolveContextWindow: (model: SessionModelRef | null) => Promise<number | null | undefined>;
}): Promise<ContextUsageSnapshot | null> {
  let contextWindow: number | null = null;
  for (const candidate of options.branch.modelCandidates) {
    const resolved = await options.resolveContextWindow(candidate);
    if (typeof resolved === "number" && resolved > 0) {
      contextWindow = resolved;
      break;
    }
  }
  if (contextWindow === null) return null;
  const projection = buildSessionProjection(
    options.branch.path as Parameters<typeof buildSessionProjection>[0],
    options.branch.leafId,
  );
  const latestEditIndex = options.branch.path.findLastIndex((entry) => entry.type === "context_edit");
  const invalidatedIds = new Set(options.branch.path.slice(0, latestEditIndex + 1).map((entry) => entry.id));
  const messages = projection.entries.flatMap(({ sourceEntry, messages }) =>
    messages
      .filter((message) => options.profile !== "bare" || message.role !== "system")
      .map((message) =>
        message.role === "assistant" && invalidatedIds.has(sourceEntry.id) ? { ...message, usage: undefined } : message,
      ),
  );
  const messagesById = new Map(projection.entries.map((entry) => [entry.sourceEntry.id, entry.messages]));
  return computeSessionContextUsage({
    messages,
    branchEntries: options.branch.path.map((entry) =>
      entry.type === "message" ? { ...entry, message: messagesById.get(entry.id)?.[0] } : entry,
    ),
    contextWindow,
  });
}

export type ContextProfile = "bare" | "agent";

export interface ContextPartition {
  readonly systemPrompt: string;
  readonly tools: readonly { name: string; description?: string; parameters?: unknown }[];
  readonly sections: Readonly<Record<string, string | null>>;
  readonly conversation: readonly AgentMessage[];
  readonly toolResults: readonly AgentMessage[];
}

export function partitionContext(messages: readonly PersistedMessage[], profile: ContextProfile): ContextPartition {
  const records = messages.filter((message) => message.role === "system");
  const display = messages.flatMap((message) => toDisplayMessage(message) ?? []);
  return {
    systemPrompt: profile === "bare" ? "" : getCurrentSystemPrompt(records),
    tools: profile === "bare" ? [] : getCurrentTools(records),
    sections: profile === "bare" ? {} : (getCurrentSystemMessage(records)?.sections ?? {}),
    conversation: display.filter((message) => message.role !== "toolResult"),
    toolResults: display.filter((message) => message.role === "toolResult"),
  };
}

export interface LiveContextUsageSource {
  readonly messages: readonly PersistedMessage[];
  readonly profile: ContextProfile;
  readonly usage: ContextUsageSnapshot | undefined;
  readonly reserveTokens?: number;
}

function scaleFixedParts(fixed: ContextUsageBreakdown, tokens: number): ContextUsageBreakdown {
  const scale = tokens / (fixed.systemPrompt + fixed.tools + fixed.agentsAndSkills);
  const tools = Math.floor(fixed.tools * scale);
  const agentsAndSkills = Math.floor(fixed.agentsAndSkills * scale);
  return {
    systemPrompt: tokens - tools - agentsAndSkills,
    tools,
    agentsAndSkills,
    conversation: 0,
    toolResults: 0,
  };
}

export function describeLiveContextUsage(source: LiveContextUsageSource): ContextUsageInfo | null {
  const usage = source.usage;
  if (!usage) return null;
  const head: ContextUsageInfo = {
    ...usage,
    ...(source.reserveTokens === undefined ? {} : { reserveTokens: source.reserveTokens }),
  };
  if (usage.tokens === null) return head;

  const partition = partitionContext(source.messages, source.profile);
  const resourceChars = (partition.sections.project_context?.length ?? 0) + (partition.sections.skills?.length ?? 0);
  const agentsAndSkills = Math.ceil(resourceChars / 4);
  const systemPrompt = Math.max(0, Math.ceil(partition.systemPrompt.length / 4) - agentsAndSkills);
  const tools = Math.ceil(partition.tools.reduce((sum, tool) => sum + JSON.stringify(tool).length, 0) / 4);
  const conversationEstimate = partition.conversation.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
  const toolResultsEstimate = partition.toolResults.reduce((sum, message) => sum + estimateMessageTokens(message), 0);

  const fixed: ContextUsageBreakdown = { systemPrompt, tools, agentsAndSkills, conversation: 0, toolResults: 0 };
  const fixedTokens = systemPrompt + tools + agentsAndSkills;
  if (fixedTokens > usage.tokens) return { ...head, breakdown: scaleFixedParts(fixed, usage.tokens) };

  const rest = usage.tokens - fixedTokens;
  if (conversationEstimate + toolResultsEstimate === 0) {
    return { ...head, breakdown: { ...fixed, conversation: rest, toolResults: 0 } };
  }
  const conversation = Math.round((rest * conversationEstimate) / (conversationEstimate + toolResultsEstimate));
  return { ...head, breakdown: { ...fixed, conversation, toolResults: rest - conversation } };
}
