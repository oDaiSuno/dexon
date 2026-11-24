import { createHash } from "node:crypto";
import type { StageRemoteAttachmentRequest, StageRemoteAttachmentResult } from "../../contract/desktop.ts";

export interface RemoteAttachmentEndpoint {
  httpBaseUrl: string;
  authToken?: string;
}

type Failure = Extract<StageRemoteAttachmentResult, { ok: false }>;
type Staged = Extract<StageRemoteAttachmentResult, { ok: true }>["staged"];
type PreparedUpload = { filename: string; mime: string; sha256: string; body: Buffer };

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_ENCODED_LENGTH = Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4;
const MAX_NAME_BYTES = 255;
const MAX_MIME_LENGTH = 255;
const MAX_ENVIRONMENT_ID_LENGTH = 1024;
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/u;
const MIME_PATTERN = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:\s*;[\u0020-\u007e]*)?$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/iu;
const HEADER_TOKEN_PATTERN = /^[\u0021-\u007e]+$/u;
const MAX_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;

function fail(code: Failure["code"], message: string): Failure {
  return { ok: false, code, message };
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

function isPlainText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength && !hasControlCharacter(value);
}

function isEncodable(value: string): boolean {
  try {
    encodeURIComponent(value);
    return true;
  } catch {
    return false;
  }
}

function validateName(name: unknown): string | Failure {
  if (
    !isPlainText(name, MAX_NAME_BYTES) ||
    !isEncodable(name) ||
    name.trim() === "" ||
    /[\\/]/u.test(name) ||
    name === "." ||
    name === ".." ||
    Buffer.byteLength(name, "utf8") > MAX_NAME_BYTES
  ) {
    return fail("unsupported-type", "Attachment filename is invalid");
  }
  return name;
}

function validateMime(mime: unknown): string | Failure {
  if (mime === undefined || mime === "") return "application/octet-stream";
  if (!isPlainText(mime, MAX_MIME_LENGTH) || !MIME_PATTERN.test(mime)) {
    return fail("unsupported-type", "Attachment content type is invalid");
  }
  return mime;
}

function decodePayload(base64: unknown): Buffer | Failure {
  if (typeof base64 !== "string") return fail("unsupported-type", "Attachment content must be a base64 string");
  if (base64.length > MAX_ENCODED_LENGTH) return fail("too-large", "Attachment exceeds the 25 MiB limit");
  if (base64.length === 0) return fail("empty-payload", "Attachment is empty");
  if (base64.length % 4 !== 0 || !BASE64_PATTERN.test(base64)) {
    return fail("unsupported-type", "Attachment content is not valid base64");
  }
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const size = (base64.length / 4) * 3 - padding;
  if (size > MAX_ATTACHMENT_BYTES) return fail("too-large", "Attachment exceeds the 25 MiB limit");
  if (size <= 0) return fail("empty-payload", "Attachment is empty");
  if (padding > 0) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const lastValue = alphabet.indexOf(base64[base64.length - padding - 1]);
    if ((lastValue & ((1 << (padding * 2)) - 1)) !== 0) {
      return fail("unsupported-type", "Attachment content is not valid base64");
    }
  }
  return Buffer.from(base64, "base64");
}

function prepareUpload(request: unknown): PreparedUpload | Failure {
  if (!request || typeof request !== "object") return fail("unsupported-type", "Attachment request is invalid");
  const { environmentId, name, mime, base64, sha256 } = request as Record<string, unknown>;
  if (!isPlainText(environmentId, MAX_ENVIRONMENT_ID_LENGTH)) {
    return fail("unsupported-type", "Attachment environment id is invalid");
  }
  const filename = validateName(name);
  if (typeof filename !== "string") return filename;
  const contentType = validateMime(mime);
  if (typeof contentType !== "string") return contentType;
  if (sha256 !== undefined && (typeof sha256 !== "string" || !SHA256_PATTERN.test(sha256))) {
    return fail("unsupported-type", "Attachment sha256 is invalid");
  }
  const body = decodePayload(base64);
  if (!Buffer.isBuffer(body)) return body;
  const digest = createHash("sha256").update(body).digest("hex");
  if (typeof sha256 === "string" && sha256.toLowerCase() !== digest) {
    return fail("unsupported-type", "Attachment sha256 does not match its content");
  }
  return { filename, mime: contentType, sha256: digest, body };
}

function isLoopback(host: string): boolean {
  return (
    host === "localhost" ||
    host === "[::1]" ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u.test(host) ||
    /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/iu.test(host)
  );
}

function resolveStageUrl(endpoint: RemoteAttachmentEndpoint): URL | Failure {
  let url: URL;
  try {
    const base = new URL(endpoint.httpBaseUrl);
    if (base.username || base.password || !["http:", "https:"].includes(base.protocol)) throw new Error("unsafe");
    url = new URL("/attachments/stage", base);
  } catch {
    return fail("disconnected", "Remote environment URL is invalid");
  }
  const { authToken } = endpoint;
  if (
    authToken !== undefined &&
    (typeof authToken !== "string" || (authToken && !HEADER_TOKEN_PATTERN.test(authToken)))
  ) {
    return fail("disconnected", "Remote environment token cannot be sent");
  }
  if (authToken && url.protocol === "http:" && !isLoopback(url.hostname)) {
    return fail("disconnected", "Plaintext authenticated upload requires a loopback host");
  }
  return url;
}

function failureForStatus(status: number): Failure {
  if (status === 404) return fail("unsupported", "Remote environment does not support attachment staging");
  if (status === 413) return fail("too-large", "Attachment exceeds the remote environment size limit");
  if (status === 400 || status === 415) return fail("unsupported-type", "Remote environment rejected the attachment");
  if (status === 401 || status === 403) return fail("disconnected", "Remote environment rejected the credentials");
  if (status >= 300 && status < 400) return fail("disconnected", "Remote environment attempted a redirect");
  if (status === 502 || status === 503 || status === 504) {
    return fail("disconnected", `Remote environment is unavailable (${status})`);
  }
  return fail("write-failed", `Remote environment failed to stage the attachment (${status})`);
}

async function readBoundedBody(response: Response): Promise<Buffer | null> {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks);
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) return null;
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function parseStaged(value: unknown, expectedSize: number): Staged | null {
  if (!value || typeof value !== "object") return null;
  const { ok, staged = value } = value as { ok?: unknown; staged?: unknown };
  if (ok !== undefined && ok !== true) return null;
  if (!staged || typeof staged !== "object") return null;
  const { path, name, mime, size, deduplicated } = staged as Record<string, unknown>;
  const filename = validateName(name);
  if (
    !isPlainText(path, 4096) ||
    typeof filename !== "string" ||
    !isPlainText(mime, MAX_MIME_LENGTH) ||
    !MIME_PATTERN.test(mime) ||
    size !== expectedSize ||
    typeof deduplicated !== "boolean"
  ) {
    return null;
  }
  return { path, name: filename, mime, size, deduplicated };
}

async function readStaged(response: Response, expectedSize: number): Promise<StageRemoteAttachmentResult> {
  const raw = await readBoundedBody(response);
  if (!raw) return fail("write-failed", "Remote environment reply is too large");
  let value: unknown;
  try {
    value = JSON.parse(raw.toString("utf8"));
  } catch {
    return fail("write-failed", "Remote environment returned an unreadable reply");
  }
  const staged = parseStaged(value, expectedSize);
  return staged ? { ok: true, staged } : fail("write-failed", "Remote environment returned an invalid reply");
}

export async function stageRemoteAttachment(
  endpoint: RemoteAttachmentEndpoint,
  request: StageRemoteAttachmentRequest,
): Promise<StageRemoteAttachmentResult> {
  const upload = prepareUpload(request);
  if ("ok" in upload) return upload;
  const url = resolveStageUrl(endpoint);
  if (!(url instanceof URL)) return url;
  const timeout = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
  const headers: Record<string, string> = {
    "content-type": upload.mime,
    "x-dexon-filename": encodeURIComponent(upload.filename),
    "x-dexon-sha256": upload.sha256,
  };
  if (endpoint.authToken) headers.authorization = `Bearer ${endpoint.authToken}`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: upload.body,
      credentials: "omit",
      redirect: "manual",
      signal: timeout,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return failureForStatus(response.status);
    }
    return await readStaged(response, upload.body.length);
  } catch {
    if (timeout.aborted) return fail("disconnected", "Remote environment timed out");
    return fail("disconnected", "Remote environment is unreachable");
  }
}
