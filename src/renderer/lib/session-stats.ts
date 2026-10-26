import type { SessionStatsSummary } from "@contract/types";
import type { AgentMessage, AssistantMessage } from "./types";

export function summarizeSessionMessages(messages: AgentMessage[]): SessionStatsSummary {
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  const costs = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let cost = 0;
  let lastCompactionAt: string | null = null;
  let userMessages = 0;
  let assistantMessages = 0;
  let toolCalls = 0;
  let toolResults = 0;
  for (const message of messages) {
    if ((message as { role?: unknown }).role === "compactionSummary") {
      const timestamp = (message as { timestamp?: unknown }).timestamp;
      if (typeof timestamp === "number") lastCompactionAt = new Date(timestamp).toISOString();
      continue;
    }
    if (message.role === "user") userMessages += 1;
    if (message.role === "toolResult") toolResults += 1;
    if (message.role !== "assistant") continue;
    assistantMessages += 1;
    const assistant = message as AssistantMessage;
    toolCalls += assistant.content.filter((block) => block.type === "toolCall").length;
    const usage = assistant.usage;
    if (!usage) continue;
    tokens.input += usage.input ?? 0;
    tokens.output += usage.output ?? 0;
    tokens.cacheRead += usage.cacheRead ?? 0;
    tokens.cacheWrite += usage.cacheWrite ?? 0;
    costs.input += usage.cost?.input ?? 0;
    costs.output += usage.cost?.output ?? 0;
    costs.cacheRead += usage.cost?.cacheRead ?? 0;
    costs.cacheWrite += usage.cost?.cacheWrite ?? 0;
    cost += usage.cost?.total ?? 0;
  }
  tokens.total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
  return {
    userMessages,
    assistantMessages,
    toolCalls,
    toolResults,
    totalMessages: messages.length,
    tokens,
    cost,
    costs,
    lastCompactionAt,
  };
}
