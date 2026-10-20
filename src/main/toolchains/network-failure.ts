const NETWORK_FAILURE_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "ENETUNREACH",
  "ENETDOWN",
  "EHOSTUNREACH",
  "EPIPE",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "ERR_INTERNET_DISCONNECTED",
  "ERR_NAME_NOT_RESOLVED",
  "ERR_NAME_RESOLUTION_FAILED",
  "ERR_ADDRESS_UNREACHABLE",
  "ERR_CONNECTION_RESET",
  "ERR_CONNECTION_REFUSED",
  "ERR_CONNECTION_CLOSED",
  "ERR_CONNECTION_ABORTED",
  "ERR_CONNECTION_FAILED",
  "ERR_CONNECTION_TIMED_OUT",
  "ERR_TIMED_OUT",
  "ERR_NETWORK_CHANGED",
  "ERR_EMPTY_RESPONSE",
  "ERR_PROXY_CONNECTION_FAILED",
]);

const MAX_CHAIN_DEPTH = 8;

function nestedFailures(error: object): unknown[] {
  const cause = (error as { cause?: unknown }).cause;
  const aggregated = (error as { errors?: unknown }).errors;
  const nested: unknown[] = [];
  if (cause !== undefined) nested.push(cause);
  if (Array.isArray(aggregated)) nested.push(...aggregated);
  return nested;
}

function ownCode(error: object): string | undefined {
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

export function networkFailureCode(error: unknown): string | undefined {
  const visited = new Set<object>();
  let pending: unknown[] = [error];
  for (let depth = 0; depth <= MAX_CHAIN_DEPTH && pending.length > 0; depth += 1) {
    const next: unknown[] = [];
    for (const candidate of pending) {
      if (typeof candidate !== "object" || candidate === null || visited.has(candidate)) continue;
      visited.add(candidate);
      const code = ownCode(candidate);
      if (code !== undefined && NETWORK_FAILURE_CODES.has(code)) return code;
      next.push(...nestedFailures(candidate));
    }
    pending = next;
  }
  return undefined;
}

export function isNetworkFailure(error: unknown): boolean {
  return networkFailureCode(error) !== undefined;
}
