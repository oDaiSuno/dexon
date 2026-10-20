import type { SessionStatsSummary } from "../contract/types";
import type { SessionEntry } from "../shared/types";

interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

function addUsage(totals: UsageTotals, usage: unknown): void {
  if (!usage || typeof usage !== "object") return;
  const record = usage as {
    input?: unknown;
    output?: unknown;
    cacheRead?: unknown;
    cacheWrite?: unknown;
    cost?: { total?: unknown };
  };
  if (typeof record.input === "number") totals.input += record.input;
  if (typeof record.output === "number") totals.output += record.output;
  if (typeof record.cacheRead === "number") totals.cacheRead += record.cacheRead;
  if (typeof record.cacheWrite === "number") totals.cacheWrite += record.cacheWrite;
  if (record.cost && typeof record.cost.total === "number") totals.cost += record.cost.total;
}

export function computeSessionStats(entries: SessionEntry[]): SessionStatsSummary {
  const totals: UsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  let userMessages = 0;
  let assistantMessages = 0;
  let toolResults = 0;
  let totalMessages = 0;
  let toolCalls = 0;
  for (const entry of entries) {
    if (entry.type === "compaction" || entry.type === "branch_summary") {
      addUsage(totals, (entry as { usage?: unknown }).usage);
    }
    if (entry.type !== "message") continue;
    totalMessages += 1;
    const message = entry.message;
    if (message.role === "user") {
      userMessages += 1;
    } else if (message.role === "toolResult") {
      toolResults += 1;
      addUsage(totals, (message as { usage?: unknown }).usage);
    } else if (message.role === "assistant") {
      assistantMessages += 1;
      if (Array.isArray(message.content)) {
        toolCalls += message.content.filter((block) => block.type === "toolCall").length;
      }
      addUsage(totals, message.usage);
    }
  }
  return {
    userMessages,
    assistantMessages,
    toolCalls,
    toolResults,
    totalMessages,
    tokens: {
      input: totals.input,
      output: totals.output,
      cacheRead: totals.cacheRead,
      cacheWrite: totals.cacheWrite,
      total: totals.input + totals.output + totals.cacheRead + totals.cacheWrite,
    },
    cost: totals.cost,
  };
}
