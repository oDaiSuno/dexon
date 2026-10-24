export function formatUsageCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

export function formatUsagePercent(percent: number): string {
  return `${percent.toFixed(0)}%`;
}

export function formatUsedTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}
