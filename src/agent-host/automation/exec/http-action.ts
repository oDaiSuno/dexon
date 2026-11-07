import type { Json } from "../../../shared/automation/spec";
import type { EffectObservation } from "../../effect-observation";
import type { HttpActionPlan } from "../core/plan";
import type { AttemptContext, SecretReader } from "./types";
import { rejected, interrupted, OutputLimitError, parseOutput } from "./observations";
import { readSecret, secretText, secretValue, SecretError } from "./secrets";

async function responseBody(response: Response, limit: number): Promise<Json> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) throw new OutputLimitError("HTTP response exceeds the configured byte limit");
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return null;
  return /\bjson\b/i.test(response.headers.get("content-type") ?? "") ? parseOutput(text, limit) : text;
}
export function createHttpAction(deps: { fetch: typeof fetch; secrets: SecretReader }) {
  return async (call: HttpActionPlan, ctx: AttemptContext): Promise<EffectObservation<Json>> => {
    let dispatched = false;
    const timeout = AbortSignal.timeout(call.timeoutMs);
    try {
      const base = new URL(call.origin);
      const url = new URL(call.pathTmpl === null ? "" : await secretText(call.pathTmpl, ctx, deps.secrets), base);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        !ctx.grant.httpOrigins.includes(url.origin) ||
        url.origin !== base.origin
      )
        return rejected("grant_violation", "HTTP origin is not approved");
      for (const [key, text] of Object.entries(call.queryTmpl ?? {}))
        url.searchParams.set(key, await secretText(text, ctx, deps.secrets));
      const headers = new Headers();
      for (const [key, text] of Object.entries(call.headersTmpl ?? {}))
        headers.set(key, await secretText(text, ctx, deps.secrets));
      for (const [key, name] of Object.entries(call.secretHeaders ?? {}))
        headers.set(key, await readSecret(name, ctx, deps.secrets));
      if (call.effect.kind === "idempotent" && !headers.has("Idempotency-Key"))
        headers.set("Idempotency-Key", ctx.effectKey);
      const body = call.bodyTmpl === null ? null : await secretValue(call.bodyTmpl, ctx, deps.secrets);
      if (body !== null && typeof body !== "string" && !headers.has("Content-Type"))
        headers.set("Content-Type", "application/json");
      if (ctx.signal.aborted) return rejected("aborted", "HTTP request cancelled before dispatch", true);
      dispatched = true;
      const response = await deps.fetch(url, {
        method: call.method,
        headers,
        body: body === null ? undefined : typeof body === "string" ? body : JSON.stringify(body),
        redirect: "manual",
        signal: AbortSignal.any([ctx.signal, timeout]),
      });
      const status = response.status;
      if (status < 200 || status >= 300) {
        await response.body?.cancel();
        const error = { code: "http_status" as const, message: `HTTP status ${status}`, detail: { status } };
        if (status >= 500) return interrupted(call.effect, error);
        return { kind: "not_applied", transient: [408, 425, 429].includes(status), error };
      }
      const output = {
        status,
        headers: Object.fromEntries(response.headers),
        body: await responseBody(response, ctx.maxOutputBytes),
      };
      return { kind: "applied", output };
    } catch (error) {
      if (error instanceof SecretError) return rejected(error.code, error.message);
      const code = timeout.aborted
        ? "timeout"
        : ctx.signal.aborted
          ? "aborted"
          : error instanceof OutputLimitError
            ? "output_too_large"
            : error instanceof SyntaxError
              ? "invalid_input"
              : "transport";
      return dispatched
        ? interrupted(call.effect, { code, message: "HTTP request did not produce a complete response" })
        : rejected("invalid_input", "HTTP request could not be prepared");
    }
  };
}
