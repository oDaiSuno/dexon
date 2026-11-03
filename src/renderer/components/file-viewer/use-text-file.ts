import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { INITIAL_TEXT_FILE_LOAD_STATE, textFileLoadReducer, type TextFileData } from "@/lib/file-viewer-load-state";
import { createBoundedTextDiff } from "@/lib/text-diff";
import { useI18n } from "@/i18n";
import { call } from "@/lib/api-client";
import { collapseDiff } from "./diff-segments";
import { useFileWatch } from "./use-file-watch";
import { useFileWorkspaceFacts } from "../app-shell/remote-workspaces-context";

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

export function useTextFile(filePath: string, sourceSessionId?: string | null, cwd?: string) {
  const { t } = useI18n();
  const [loadState, dispatchLoad] = useReducer(textFileLoadReducer, INITIAL_TEXT_FILE_LOAD_STATE);
  const [head, setHead] = useState<{ filePath: string; content: string } | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [viewMode, setViewMode] = useState<TextViewMode>("source");
  const [wrapLines, setWrapLines] = useState(false);
  const facts = useFileWorkspaceFacts(filePath, cwd);
  const remoteFile = facts.kind === "ssh";
  const connected = !remoteFile || facts.connection === "connected";
  const previousConnection = useRef(connected);

  const loadGen = useRef(0);

  const fetchContent = useCallback(
    (targetPath: string) => {
      const gen = ++loadGen.current;
      return import("@/lib/file-blob")
        .then(({ readFilePayload }) => readFilePayload(targetPath, sourceSessionId))
        .then((d) => {
          if (gen !== loadGen.current) return null;
          if (d.error) {
            dispatchLoad({ type: "failed", error: d.error, retainSnapshot: remoteFile });
            return null;
          }
          if (d.encoding === "too_large") {
            dispatchLoad({
              type: "failed",
              error: t("fileTooLargeForPreview", "File is too large for preview"),
              retainSnapshot: remoteFile,
            });
            return null;
          }
          if (d.encoding === "base64") {
            dispatchLoad({
              type: "failed",
              error: t("binaryFileCannotShowText", "Binary file cannot be shown as text"),
              retainSnapshot: remoteFile,
            });
            return null;
          }
          const payload: TextFileData = {
            content: d.content,
            language: d.language ?? "text",
            size: d.size ?? d.content.length,
            space: d.space,
            remoteHostLabel: d.remoteHostLabel,
          };
          dispatchLoad({ type: "succeeded", data: payload });
          return payload;
        })
        .catch((e) => {
          if (gen !== loadGen.current) return null;
          dispatchLoad({ type: "failed", error: String(e), retainSnapshot: remoteFile });
          return null;
        });
    },
    [sourceSessionId, t, remoteFile],
  );

  const fetchHead = useCallback(() => {
    const gen = loadGen.current;
    return call("git.headContent", { path: filePath, sourceSessionId: sourceSessionId ?? undefined })
      .then((r) => {
        if (gen === loadGen.current) setHead(r.comparable ? { filePath, content: r.content } : null);
      })
      .catch(() => {
        if (gen === loadGen.current) setHead(null);
      });
  }, [filePath, sourceSessionId]);

  useEffect(() => {
    dispatchLoad({ type: "reset" });
    setHead(null);
    setPreviewMode(false);
    setViewMode("source");
    setWrapLines(false);
    void fetchContent(filePath).then((data) => {
      if (data?.language === "markdown") setPreviewMode(true);
    });
    void fetchHead();

    return () => {
      loadGen.current += 1;
    };
  }, [filePath, fetchContent, fetchHead, sourceSessionId]);

  const reload = useCallback(() => {
    void fetchContent(filePath);
    void fetchHead();
  }, [fetchContent, fetchHead, filePath]);
  const watching = useFileWatch(filePath, sourceSessionId, reload, cwd);

  useEffect(() => {
    if (connected && !previousConnection.current) reload();
    previousConnection.current = connected;
  }, [connected, reload]);

  const content = loadState.status === "ready" ? loadState.data.content : null;
  const headContent = head && head.filePath === filePath ? head.content : null;
  const hasDiff = content !== null && headContent !== null;
  const diffSummary = useMemo(
    () => (hasDiff && headContent !== content ? summarizeDiff(headContent!, content!) : null),
    [hasDiff, headContent, content],
  );

  return {
    loadState,
    hasDiff,
    headContent,
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
