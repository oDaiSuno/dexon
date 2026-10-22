import { useTheme } from "@/hooks/useTheme";
import { getRelativeFilePath } from "@/lib/file-paths";
import { useI18n } from "@/i18n";
import { formatFileSize, formatNumber } from "@/lib/locale-format";
import { DownloadLink } from "./download-link";
import { TextFileContent } from "./text-file-content";
import { TextModeToggles } from "./text-mode-toggles";
import type { FileViewerProps } from "./types";
import { useTextFile } from "./use-text-file";
import { WatchIndicator } from "./watch-indicator";

export function TextFileViewer({ filePath, cwd, sourceSessionId }: FileViewerProps) {
  const { isDark } = useTheme();
  const { language, t } = useI18n();
  const { loadState, previewMode, setPreviewMode, viewMode, setViewMode, wrapLines, setWrapLines, watching } =
    useTextFile(filePath, sourceSessionId);

  if (loadState.status === "loading") {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--fx-text-secondary)",
          fontSize: "var(--text-body)",
        }}
      >
        {t("loading", "Loading…")}
      </div>
    );
  }

  if (loadState.status === "error") {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--fx-status-danger)",
          fontSize: "var(--text-body)",
        }}
      >
        {loadState.error}
      </div>
    );
  }

  const { data, prevContent, changeCount } = loadState;

  const lines = data.content.split("\n");
  const hasDiff = prevContent !== null && prevContent !== data.content;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          minHeight: 40,
          padding: "4px 12px",
          borderBottom: "1px solid var(--fx-line-default)",
          fontSize: "var(--text-label)",
          color: "var(--fx-text-tertiary)",
          background: "var(--fx-surface-main)",
          flexShrink: 0,
          overflowX: "auto",
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ fontFamily: "var(--font-mono)" }} title={filePath}>
          {getRelativeFilePath(filePath, cwd)}
        </span>
        <span style={{ marginLeft: "auto" }}>{data.language}</span>
        {viewMode === "source" && (
          <span>{t("lineCount", "{count} lines").replace("{count}", formatNumber(lines.length, language))}</span>
        )}
        <span>{formatFileSize(data.size, language)}</span>
        <WatchIndicator watching={watching} />
        <TextModeToggles
          data={data}
          changeCount={changeCount}
          hasDiff={hasDiff}
          viewMode={viewMode}
          setViewMode={setViewMode}
          previewMode={previewMode}
          setPreviewMode={setPreviewMode}
          wrapLines={wrapLines}
          setWrapLines={setWrapLines}
        />
        <DownloadLink filePath={filePath} sourceSessionId={sourceSessionId} />
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
        isDark={isDark}
      />
    </div>
  );
}
