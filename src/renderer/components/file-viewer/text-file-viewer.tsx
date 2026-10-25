import { useState, type MouseEvent } from "react";
import type { TextFileData } from "@/lib/file-viewer-load-state";
import { useI18n } from "@/i18n";
import { PathCrumbs } from "./path-crumbs";
import type { SourceCursor } from "./source-view";
import { StatusBar } from "./status-bar";
import { TextFileContent } from "./text-file-content";
import { TextModeToggles, type TextModeTogglesProps } from "./text-mode-toggles";
import type { FileViewerProps } from "./types";
import { useTextFile } from "./use-text-file";
import { WatchIndicator } from "./watch-indicator";

const PLACEHOLDER_STYLE = {
  height: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
} as const;

export function TextFileViewer({ filePath, cwd, sourceSessionId }: FileViewerProps) {
  const { t } = useI18n();
  const {
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
  } = useTextFile(filePath, sourceSessionId);

  if (loadState.status === "loading") {
    return (
      <div className="type-body-default" style={{ ...PLACEHOLDER_STYLE, color: "var(--fx-text-secondary)" }}>
        {t("loading", "Loading…")}
      </div>
    );
  }

  if (loadState.status === "error") {
    return (
      <div className="type-body-default" style={{ ...PLACEHOLDER_STYLE, color: "var(--fx-status-danger)" }}>
        {loadState.error}
      </div>
    );
  }

  return (
    <TextFileReady
      filePath={filePath}
      cwd={cwd}
      sourceSessionId={sourceSessionId}
      data={loadState.data}
      prevContent={loadState.prevContent}
      hasDiff={hasDiff}
      diffSummary={diffSummary}
      viewMode={viewMode}
      setViewMode={setViewMode}
      previewMode={previewMode}
      setPreviewMode={setPreviewMode}
      wrapLines={wrapLines}
      setWrapLines={setWrapLines}
      watching={watching}
    />
  );
}

export interface TextFileReadyProps extends FileViewerProps, Omit<TextModeTogglesProps, "data"> {
  data: TextFileData;
  prevContent: string | null;
  watching: boolean;
}

export function TextFileReady({
  filePath,
  cwd,
  sourceSessionId,
  data,
  prevContent,
  hasDiff,
  diffSummary,
  viewMode,
  setViewMode,
  previewMode,
  setPreviewMode,
  wrapLines,
  setWrapLines,
  watching,
}: TextFileReadyProps) {
  const { language } = useI18n();
  const [cursor, setCursor] = useState<SourceCursor | null>(null);
  const previewable = data.language === "html" || data.language === "markdown";
  const mode = viewMode === "diff" && hasDiff ? "diff" : previewable && previewMode ? "preview" : "source";
  const lineCount = data.content.split("\n").length;
  const visibleCursor = mode === "source" && cursor && cursor.line <= lineCount ? cursor : null;

  const openFileMenu = (event: MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || !window.piBridge?.showFileContextMenu) return;
    event.preventDefault();
    void window.piBridge
      .showFileContextMenu({ href: filePath, cwd, source: "local-file-reference", language })
      .catch(() => undefined);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div className="file-viewer-meta" onContextMenu={openFileMenu}>
        <PathCrumbs filePath={filePath} cwd={cwd} />
        <WatchIndicator watching={watching} showLabel={mode !== "diff"} />
        <TextModeToggles
          data={data}
          hasDiff={hasDiff}
          diffSummary={diffSummary}
          viewMode={viewMode}
          setViewMode={setViewMode}
          previewMode={previewMode}
          setPreviewMode={setPreviewMode}
          wrapLines={wrapLines}
          setWrapLines={setWrapLines}
        />
      </div>
      <TextFileContent
        filePath={filePath}
        cwd={cwd}
        sourceSessionId={sourceSessionId}
        data={data}
        prevContent={prevContent}
        hasDiff={hasDiff}
        viewMode={viewMode}
        previewMode={previewMode}
        wrapLines={wrapLines}
        cursorLine={visibleCursor?.line ?? null}
        onCursorChange={setCursor}
      />
      <StatusBar
        filePath={filePath}
        data={data}
        lineCount={lineCount}
        mode={mode}
        diffSummary={diffSummary}
        cursor={visibleCursor}
      />
    </div>
  );
}
