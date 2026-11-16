import { fetchFileRoute } from "./api-file-route";
import { isApiShimRequest } from "./api-fetch-policy";

type Json = unknown;

function jsonResponse(data: Json, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status = 500): Response {
  return jsonResponse({ error: message }, status);
}

export async function apiFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.pathname + input.search : input.url;

  const path = url.startsWith("http") ? new URL(url).pathname + new URL(url).search : url;
  if (!path.startsWith("/api/")) {
    return fetch(input as RequestInfo, init);
  }

  const method = (init?.method ?? "GET").toUpperCase();
  const u = new URL(path, "http://local");
  try {
    if (u.pathname === "/api/files" || u.pathname.startsWith("/api/files/")) return await fetchFileRoute(u);
    return errorResponse(`Unmapped API route: ${method} ${u.pathname}`, 404);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const rpc = e as { code?: string; detail?: unknown };
    const status =
      rpc.code === "BAD_REQUEST"
        ? 400
        : rpc.code === "FORBIDDEN"
          ? 403
          : rpc.code === "NOT_FOUND"
            ? 404
            : rpc.code === "CONFLICT"
              ? 409
              : /not found/i.test(msg)
                ? 404
                : /denied|forbidden/i.test(msg)
                  ? 403
                  : 500;
    const detail = rpc.detail && typeof rpc.detail === "object" ? rpc.detail : {};
    return jsonResponse({ error: msg, ...detail, ...(rpc.code ? { code: rpc.code } : {}) }, status);
  }
}

export function installApiShims(): void {
  const originalFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (isApiShimRequest(input, window.location.href)) {
      return apiFetch(input as string, init);
    }
    return originalFetch(input as RequestInfo, init);
  }) as typeof fetch;
}
