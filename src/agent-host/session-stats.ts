import type { SessionStatsSummary } from "../contract/types";
import type { SessionEntry } from "../shared/types";

interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

interface CostTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

function addUsage(totals: UsageTotals, costs: CostTotals, usage: unknown): void {
  if (!usage || typeof usage !== "object") return;
  const record = usage as {
    input?: unknown;
    output?: unknown;
    cacheRead?: unknown;
    cacheWrite?: unknown;
    cost?: { input?: unknown; output?: unknown; cacheRead?: unknown; cacheWrite?: unknown; total?: unknown };
  };
  if (typeof record.input === "number") totals.input += record.input;
  if (typeof record.output === "number") totals.output += record.output;
  if (typeof record.cacheRead === "number") totals.cacheRead += record.cacheRead;
  if (typeof record.cacheWrite === "number") totals.cacheWrite += record.cacheWrite;
  if (record.cost && typeof record.cost.total === "number") totals.cost += record.cost.total;
  if (!record.cost) return;
  if (typeof record.cost.input === "number") costs.input += record.cost.input;
  if (typeof record.cost.output === "number") costs.output += record.cost.output;
  if (typeof record.cost.cacheRead === "number") costs.cacheRead += record.cost.cacheRead;
  if (typeof record.cost.cacheWrite === "number") costs.cacheWrite += record.cost.cacheWrite;
}

export function computeSessionStats(entries: SessionEntry[]): SessionStatsSummary {
  const totals: UsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  const costs: CostTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let lastCompactionAt: string | null = null;
  let userMessages = 0;
  let assistantMessages = 0;
  let toolResults = 0;
  let totalMessages = 0;
  let toolCalls = 0;
  for (const entry of entries) {
    if (entry.type === "compaction") lastCompactionAt = entry.timestamp;
    if (entry.type === "compaction" || entry.type === "branch_summary") {
      addUsage(totals, costs, (entry as { usage?: unknown }).usage);
    }
    if (entry.type !== "message") continue;
    totalMessages += 1;
    const message = entry.message;
    if (message.role === "user") {
      userMessages += 1;
    } else if (message.role === "toolResult") {
      toolResults += 1;
      addUsage(totals, costs, (message as { usage?: unknown }).usage);
    } else if (message.role === "assistant") {
      assistantMessages += 1;
      if (Array.isArray(message.content)) {
        toolCalls += message.content.filter((block) => block.type === "toolCall").length;
      }
      addUsage(totals, costs, message.usage);
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
    costs,
    lastCompactionAt,
  };
}
