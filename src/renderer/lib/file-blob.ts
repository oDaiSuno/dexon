import { qualifyProjectKey, type EnvironmentId } from "@contract/environment";
import { getEnvironmentApiClient } from "./api-client";

export type FileReadResult = {
  content: string;
  encoding?: "utf8" | "base64" | "too_large";
  mime?: string;
  language?: string;
  size?: number;
  truncated?: boolean;
  error?: string;
};

export async function readFilePayload(
  environmentId: EnvironmentId,
  filePath: string,
  sourceSessionId?: string | null,
): Promise<FileReadResult> {
  return getEnvironmentApiClient(environmentId).call("files.read", {
    path: filePath,
    sourceSessionId: sourceSessionId ?? undefined,
  });
}

export function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime || "application/octet-stream" });
}

type FileBlob = { blob: Blob; mime: string; size: number };
const pendingBlobs = new Map<string, { sourceSessionId?: string | null; promise: Promise<FileBlob> }>();

export async function fileToObjectUrl(
  environmentId: EnvironmentId,
  filePath: string,
  sourceSessionId?: string | null,
): Promise<{ url: string; mime: string; size: number; revoke: () => void }> {
  const key = qualifyProjectKey(environmentId, filePath);
  let pending = pendingBlobs.get(key);
  if (!pending || pending.sourceSessionId !== sourceSessionId) {
    const promise = readFilePayload(environmentId, filePath, sourceSessionId).then((data) => {
      if (data.error) throw new Error(data.error);
      if (data.encoding === "too_large") throw new Error("File too large for preview");
      const mime = data.mime || (data.encoding === "base64" ? "application/octet-stream" : "text/plain;charset=utf-8");
      const blob =
        data.encoding === "base64" ? base64ToBlob(data.content, mime) : new Blob([data.content ?? ""], { type: mime });
      return { blob, mime, size: data.size ?? blob.size };
    });
    pending = { sourceSessionId, promise };
    pendingBlobs.set(key, pending);
  }
  try {
    const { blob, mime, size } = await pending.promise;
    const url = URL.createObjectURL(blob);
    return { url, mime, size, revoke: () => URL.revokeObjectURL(url) };
  } finally {
    if (pendingBlobs.get(key) === pending) pendingBlobs.delete(key);
  }
}

export async function downloadFileViaRpc(
  environmentId: EnvironmentId,
  filePath: string,
  fileName: string,
  sourceSessionId?: string | null,
): Promise<void> {
  const data = await getEnvironmentApiClient(environmentId).call("files.download", {
    path: filePath,
    sourceSessionId: sourceSessionId ?? undefined,
  });
  const blob = base64ToBlob(data.base64, data.mime);

  if (window.piBridge?.saveBinaryFile) {
    const saved = await window.piBridge.saveBinaryFile({
      base64: data.base64,
      defaultPath: fileName,
    });
    if (saved) {
      await window.piBridge.showItemInFolder(saved);
      return;
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
