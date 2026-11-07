import { PRIMARY_ENVIRONMENT_ID, qualifyProjectKey, type EnvironmentId } from "@contract/environment";
import { getActiveEnvironmentId } from "./environment-registry";
import { readFilePayload } from "./file-blob";

const MAX_CACHE_ENTRIES = 128;

const cache = new Map<string, Promise<string | null>>();

function evictIfNeeded(): void {
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

export function registerStagedPreviewUrl(
  path: string,
  url: string,
  environmentId: EnvironmentId = PRIMARY_ENVIRONMENT_ID,
): void {
  if (!path || !url) return;
  const key = qualifyProjectKey(environmentId, path);
  if (!cache.has(key)) cache.set(key, Promise.resolve(url));
  evictIfNeeded();
}

export function loadAttachmentPreview(
  path: string,
  sessionId?: string,
  environmentId: EnvironmentId = getActiveEnvironmentId(),
): Promise<string | null> {
  const key = qualifyProjectKey(environmentId, path);
  const cached = cache.get(key);
  if (cached) return cached;
  const pending = (async () => {
    try {
      const result = await readFilePayload(environmentId, path, sessionId);
      if (!result || result.encoding !== "base64") return null;
      const mime = typeof result.mime === "string" ? result.mime : "application/octet-stream";
      const bytes = base64ToBytes(result.content);
      return URL.createObjectURL(new Blob([bytes], { type: mime }));
    } catch {
      return null;
    }
  })();
  cache.set(key, pending);
  void pending.then((url) => {
    if (!url && cache.get(key) === pending) cache.delete(key);
  });
  evictIfNeeded();
  return pending;
}

function base64ToBytes(data: string): Uint8Array<ArrayBuffer> {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
