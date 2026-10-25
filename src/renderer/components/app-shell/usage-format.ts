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

export function formatUsageShare(tokens: number, contextWindow: number): string {
  return `${((tokens / contextWindow) * 100).toFixed(1)}%`;
}

export function allocateGridCells(parts: number[], contextWindow: number, cells: number): number[] {
  const sum = parts.reduce((total, part) => total + part, 0);
  const denom = Math.max(contextWindow, sum);
  if (!(denom > 0)) return parts.map(() => 0);
  const total = Math.round((cells * sum) / denom);
  const exact = parts.map((part) => (part * cells) / denom);
  const allocated = exact.map((value) => Math.floor(value));
  let missing = total - allocated.reduce((count, value) => count + value, 0);
  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index);
  for (let position = 0; missing > 0 && position < order.length; position += 1, missing -= 1) {
    allocated[order[position].index] += 1;
  }
  return allocated;
}
