import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "@/hooks/useTheme";
import { DOCX_PREVIEW_MAX_BYTES } from "@/lib/file-types";
import { createDocxPreviewHtml } from "@/lib/docx-preview-html";
import { useI18n } from "@/i18n";
import { useFileWatch } from "./use-file-watch";

export function useDocumentPreview(filePath: string, sourceSessionId: string | null | undefined, isPdf: boolean) {
  const { isDark } = useTheme();
  const { t } = useI18n();
  const [bust, setBust] = useState(0);
  const [size, setSize] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const revokeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setSize(null);
    revokeRef.current?.();
    revokeRef.current = null;
    setPreviewUrl(null);

    void (async () => {
      try {
        if (isPdf) {
          const { fileToObjectUrl } = await import("@/lib/file-blob");
          const r = await fileToObjectUrl(filePath, sourceSessionId);
          if (cancelled) {
            r.revoke();
            return;
          }
          revokeRef.current = r.revoke;
          setPreviewUrl(r.url);
          setSize(r.size);
          return;
        }
        const { call } = await import("@/lib/api-client");
        const preview = await call("files.preview", {
          path: filePath,
          sourceSessionId: sourceSessionId ?? undefined,
        });
        if (cancelled) return;
        if (preview.kind === "too_large") {
          setError(t("docxTooLarge", "DOCX is too large for preview (>10 MB)"));
          return;
        }
        if (preview.kind === "docx" && preview.base64) {
          const mammoth = await import("mammoth");
          const binary = Uint8Array.from(atob(preview.base64), (c) => c.charCodeAt(0));
          const result = await mammoth.convertToHtml(
            { arrayBuffer: binary.buffer },
            { convertImage: mammoth.images.dataUri },
          );
          if (cancelled) return;
          const html = createDocxPreviewHtml(result.value, isDark ? "dark" : "light");
          const blob = new Blob([html], { type: "text/html;charset=utf-8" });
          const url = URL.createObjectURL(blob);
          revokeRef.current = () => URL.revokeObjectURL(url);
          setPreviewUrl(url);
        } else {
          setError(t("previewUnavailable", "Preview not available"));
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
      revokeRef.current?.();
      revokeRef.current = null;
    };
  }, [filePath, isDark, isPdf, sourceSessionId, bust, t]);

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
    [isPdf, t],
  );
  const watching = useFileWatch(filePath, sourceSessionId, onChange);

  return { size, error, previewUrl, watching };
}
