import { useCallback, useState } from "react";
import type { FilePreviewResource } from "@/lib/file-blob";
import { useTheme } from "@/hooks/useTheme";
import { DOCX_PREVIEW_MAX_BYTES } from "@/lib/file-types";
import { createDocxPreviewHtml } from "@/lib/docx-preview-html";
import { useI18n } from "@/i18n";
import { useFileWatch } from "./use-file-watch";
import { usePreviewResource } from "./use-preview-resource";

export function useDocumentPreview(
  filePath: string,
  sourceSessionId: string | null | undefined,
  isPdf: boolean,
  cwd?: string,
) {
  const { isDark } = useTheme();
  const { t } = useI18n();
  const [bust, setBust] = useState(0);
  const load = useCallback(async (): Promise<FilePreviewResource> => {
    if (isPdf) {
      const { fileToObjectUrl } = await import("@/lib/file-blob");
      return fileToObjectUrl(filePath, sourceSessionId);
    }
    const { call } = await import("@/lib/api-client");
    const preview = await call("files.preview", { path: filePath, sourceSessionId: sourceSessionId ?? undefined });
    if (preview.kind === "too_large") throw new Error(t("docxTooLarge", "DOCX is too large for preview (>10 MB)"));
    if (preview.kind !== "docx" || !preview.base64) throw new Error(t("previewUnavailable", "Preview not available"));
    const mammoth = await import("mammoth");
    const binary = Uint8Array.from(atob(preview.base64), (c) => c.charCodeAt(0));
    const result = await mammoth.convertToHtml(
      { arrayBuffer: binary.buffer },
      { convertImage: mammoth.images.dataUri },
    );
    const html = createDocxPreviewHtml(result.value, isDark ? "dark" : "light");
    const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
    const space =
      preview.space === "local" || preview.space === "remote" || preview.space === "local-overlay"
        ? preview.space
        : undefined;
    return {
      url,
      revoke: () => URL.revokeObjectURL(url),
      size: typeof preview.size === "number" ? preview.size : undefined,
      space,
      remoteHostLabel: typeof preview.remoteHostLabel === "string" ? preview.remoteHostLabel : undefined,
    };
  }, [filePath, isDark, isPdf, sourceSessionId, t]);
  const { resource, size, error, setError, setSize } = usePreviewResource(filePath, sourceSessionId, cwd, bust, load);
  const onChange = useCallback(
    (s?: number) => {
      if (typeof s === "number") {
        setSize(s);
        if (!isPdf && s > DOCX_PREVIEW_MAX_BYTES) {
          setError(t("docxTooLarge", "DOCX is too large for preview (>10 MB)"));
          return;
        }
      }
      setError(null);
      setBust((b) => b + 1);
    },
    [isPdf, setError, setSize, t],
  );
  const watching = useFileWatch(filePath, sourceSessionId, onChange, cwd);
  return {
    size,
    error,
    previewUrl: resource?.url ?? null,
    watching,
    space: resource?.space,
    remoteHostLabel: resource?.remoteHostLabel,
  };
}
