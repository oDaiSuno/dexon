import { readFile } from "@/lib/api-client";

/**
 * Object-URL cache for attachment token previews.
 *
 * Freshly staged clipboard images have their bytes in the renderer at paste
 * time, so their preview is registered synchronously before the token is even
 * inserted. Everything else (history messages, restored drafts with files that
 * still exist) loads lazily through the `files.read` bridge, which allows
 * paths that appear in the session's message text.
 *
 * Evicted entries are not revoked: blob URLs are tiny bookkeeping objects and
 * revoking one that is still displayed in the transcript would break rendering.
 * The cache is capped high enough that realistic sessions never hit it.
 */

const MAX_CACHE_ENTRIES = 128;

const cache = new Map<string, Promise<string | null>>();

function evictIfNeeded(): void {
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

/** Register a preview URL produced from in-memory bytes (fresh paste path). */
export function registerStagedPreviewUrl(path: string, url: string): void {
  if (!path || !url || cache.has(path)) return;
  cache.set(path, Promise.resolve(url));
}

/** Resolve a preview object URL for a token path; null when unavailable. */
export function loadAttachmentPreview(path: string, sessionId?: string): Promise<string | null> {
  const cached = cache.get(path);
  if (cached) return cached;
  const pending = (async () => {
    try {
      const result = await readFile(path, sessionId);
      if (!result || result.encoding !== "base64") return null;
      const mime = typeof result.mime === "string" ? result.mime : "application/octet-stream";
      const bytes = base64ToBytes(result.content);
      return URL.createObjectURL(new Blob([bytes], { type: mime }));
    } catch {
      return null;
    }
  })();
  cache.set(path, pending);
  evictIfNeeded();
  return pending;
}

function base64ToBytes(data: string): Uint8Array<ArrayBuffer> {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Test hook: drop the whole cache. */
export function clearAttachmentPreviewCacheForTests(): void {
  cache.clear();
}
