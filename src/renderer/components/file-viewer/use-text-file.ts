import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { INITIAL_TEXT_FILE_LOAD_STATE, textFileLoadReducer, type TextFileData } from "@/lib/file-viewer-load-state";
import { createBoundedTextDiff } from "@/lib/text-diff";
import { useI18n } from "@/i18n";
import { collapseDiff } from "./diff-segments";
import { getFileApiUrl } from "./file-api-url";

export type TextViewMode = "source" | "diff";

export interface DiffSummary {
  added: number;
  removed: number;
  hunks: number;
}

function summarizeDiff(oldContent: string, newContent: string): DiffSummary | null {
  const result = createBoundedTextDiff(oldContent, newContent);
  if (result.kind === "fallback") return null;
  return {
    added: result.lines.filter((line) => line.type === "added").length,
    removed: result.lines.filter((line) => line.type === "removed").length,
    hunks: collapseDiff(result.lines).filter((segment) => !segment.hidden).length,
  };
}

export function useTextFile(filePath: string, sourceSessionId?: string | null) {
  const { t } = useI18n();
  const [loadState, dispatchLoad] = useReducer(textFileLoadReducer, INITIAL_TEXT_FILE_LOAD_STATE);
  const [previewMode, setPreviewMode] = useState(false);
  const [viewMode, setViewMode] = useState<TextViewMode>("source");
  const [wrapLines, setWrapLines] = useState(false);
  const [watching, setWatching] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  const loadGen = useRef(0);

  const fetchContent = useCallback(
    (targetPath: string, isRefresh = false) => {
      const gen = ++loadGen.current;
      return import("@/lib/file-blob")
        .then(({ readFilePayload }) => readFilePayload(targetPath, sourceSessionId))
        .then((d) => {
          if (gen !== loadGen.current) return null;
          if (d.error) {
            dispatchLoad({ type: "failed", error: d.error });
            return null;
          }
          if (d.encoding === "too_large") {
            dispatchLoad({ type: "failed", error: t("fileTooLargeForPreview", "File is too large for preview") });
            return null;
          }
          if (d.encoding === "base64") {
            dispatchLoad({
              type: "failed",
              error: t("binaryFileCannotShowText", "Binary file cannot be shown as text"),
            });
            return null;
          }
          const payload: TextFileData = {
            content: d.content,
            language: d.language ?? "text",
            size: d.size ?? d.content.length,
          };
          dispatchLoad({ type: "succeeded", data: payload, refresh: isRefresh });
          return payload;
        })
        .catch((e) => {
          if (gen !== loadGen.current) return null;
          dispatchLoad({ type: "failed", error: String(e) });
          return null;
        });
    },
    [sourceSessionId, t],
  );

  useEffect(() => {
    dispatchLoad({ type: "reset" });
    setPreviewMode(false);
    setViewMode("source");
    setWrapLines(false);
    setWatching(false);

    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    void fetchContent(filePath).then((data) => {
      if (data?.language === "markdown") setPreviewMode(true);
    });

    const es = new EventSource(getFileApiUrl(filePath, "watch", sourceSessionId));
    esRef.current = es;

    es.addEventListener("connected", () => {
      setWatching(true);
    });

    es.addEventListener("change", () => {
      void fetchContent(filePath, true);
    });

    es.addEventListener("error", () => {
      setWatching(false);
    });

    es.onerror = () => {
      setWatching(false);
    };

    return () => {
      loadGen.current += 1;
      es.close();
      esRef.current = null;
    };
  }, [filePath, fetchContent, sourceSessionId]);

  const content = loadState.status === "ready" ? loadState.data.content : null;
  const prevContent = loadState.status === "ready" ? loadState.prevContent : null;
  const hasDiff = content !== null && prevContent !== null && prevContent !== content;
  const diffSummary = useMemo(
    () => (hasDiff ? summarizeDiff(prevContent!, content!) : null),
    [hasDiff, prevContent, content],
  );

  return {
    loadState,
    hasDiff,
    diffSummary,
    previewMode,
    setPreviewMode,
    viewMode,
    setViewMode,
    wrapLines,
    setWrapLines,
    watching,
  };
}
