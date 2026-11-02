import type { SessionStatsSummary } from "../contract/types";
import type { SessionEntry } from "../shared/types";

type UsageComponents = SessionStatsSummary["costs"];

interface UsageTotals {
  tokens: UsageComponents;
  cost: number;
  costs: UsageComponents;
}

function emptyUsage(): UsageTotals {
  return {
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    cost: 0,
    costs: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}

function addUsage(totals: UsageTotals, usage: unknown): void {
  if (!usage || typeof usage !== "object") return;
  const record = usage as {
    input?: unknown;
    output?: unknown;
    cacheRead?: unknown;
    cacheWrite?: unknown;
    cost?: { input?: unknown; output?: unknown; cacheRead?: unknown; cacheWrite?: unknown; total?: unknown };
  };
  for (const key of ["input", "output", "cacheRead", "cacheWrite"] as const) {
    const tokens = record[key];
    const cost = record.cost?.[key];
    if (typeof tokens === "number") totals.tokens[key] += tokens;
    if (typeof cost === "number") totals.costs[key] += cost;
  }
  if (typeof record.cost?.total === "number") totals.cost += record.cost.total;
}

function summarizeUsage(totals: UsageTotals): Pick<SessionStatsSummary, "tokens" | "cost" | "costs"> {
  const { input, output, cacheRead, cacheWrite } = totals.tokens;
  return {
    tokens: { input, output, cacheRead, cacheWrite, total: input + output + cacheRead + cacheWrite },
    cost: totals.cost,
    costs: totals.costs,
  };
}

export function computeSessionStats(entries: SessionEntry[]): SessionStatsSummary {
  const totals = emptyUsage();
  const auxiliary = new Map<string, UsageTotals>();
  let lastCompactionAt: string | null = null;
  let userMessages = 0;
  let assistantMessages = 0;
  let toolResults = 0;
  let totalMessages = 0;
  let toolCalls = 0;
  for (const entry of entries) {
    if (entry.type === "usage") {
      const usage = auxiliary.get(entry.kind) ?? emptyUsage();
      addUsage(usage, entry.usage);
      auxiliary.set(entry.kind, usage);
      continue;
    }
    if (entry.type === "compaction") lastCompactionAt = entry.timestamp;
    if (entry.type === "compaction" || entry.type === "branch_summary") {
      addUsage(totals, (entry as { usage?: unknown }).usage);
    }
    if (entry.type !== "message" || entry.message.role === "system") continue;
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
    ...summarizeUsage(totals),
    lastCompactionAt,
    ...(auxiliary.size === 0
      ? {}
      : {
          auxiliaryUsage: [...auxiliary].map(([kind, usage]) => ({ kind, ...summarizeUsage(usage) })),
        }),
  };
}
