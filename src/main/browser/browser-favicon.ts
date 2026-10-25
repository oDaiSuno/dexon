import type { Session } from "electron";
import { readBoundedResponseBody } from "./browser-response-body.ts";

const MAX_FAVICON_BYTES = 262_144;
const MAX_FAVICON_URL_LENGTH = 2_048;

export function pickFaviconUrl(urls: string[]): string | null {
  for (const candidate of urls) {
    if (typeof candidate !== "string" || candidate.length > MAX_FAVICON_URL_LENGTH) continue;
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    if (url.username || url.password) continue;
    return candidate;
  }
  return null;
}

export function faviconDataUrl(contentType: string | null, body: Buffer): string | null {
  const mime = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (!body.length || !mime.startsWith("image/")) return null;
  return `data:${mime};base64,${body.toString("base64")}`;
}

export async function loadFavicon(session: Session, url: string, signal: AbortSignal): Promise<string | null> {
  try {
    const response = await session.fetch(url, { redirect: "follow", signal });
    if (!response.ok) return null;
    const body = await readBoundedResponseBody(response, MAX_FAVICON_BYTES, signal);
    return faviconDataUrl(response.headers.get("content-type"), body);
  } catch {
    return null;
  }
}
