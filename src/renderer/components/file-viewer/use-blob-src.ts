import { useCallback } from "react";
import { usePreviewResource } from "./use-preview-resource";

export function useBlobSrc(filePath: string, sourceSessionId?: string | null, bust = 0, cwd?: string) {
  const load = useCallback(async () => {
    const { fileToObjectUrl } = await import("@/lib/file-blob");
    return fileToObjectUrl(filePath, sourceSessionId);
  }, [filePath, sourceSessionId]);
  const { resource, ...state } = usePreviewResource(filePath, sourceSessionId, cwd, bust, load);
  return { ...state, src: resource?.url ?? null, space: resource?.space, remoteHostLabel: resource?.remoteHostLabel };
}
