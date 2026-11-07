import type { EnvironmentId } from "@contract/environment";
import { encodeFilePathForApi } from "@/lib/file-paths";

export function getFileApiUrl(
  environmentId: EnvironmentId,
  filePath: string,
  type: "list" | "read" | "download" | "meta" | "preview" | "watch",
  sourceSessionId?: string | null,
  params: Record<string, string | number | undefined> = {},
): string {
  const encoded = encodeFilePathForApi(filePath);
  const searchParams = new URLSearchParams({ type });
  if (sourceSessionId) searchParams.set("sessionId", sourceSessionId);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) searchParams.set(key, String(value));
  }
  searchParams.set("environment", environmentId);
  return `/api/files/${encoded}?${searchParams.toString()}`;
}
