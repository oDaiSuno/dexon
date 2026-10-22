import { getFileExt } from "@/lib/file-types";
import { getFileName, getRelativeFilePath } from "@/lib/file-paths";
import { useI18n } from "@/i18n";
import { formatFileSize } from "@/lib/locale-format";
import { DownloadLink } from "./download-link";
import type { FileViewerProps } from "./types";
import { useDocumentPreview } from "./use-document-preview";
import { WatchIndicator } from "./watch-indicator";

export function DocumentViewer({ filePath, cwd, sourceSessionId }: FileViewerProps) {
  const { language, t } = useI18n();
  const ext = getFileExt(filePath);
  const isPdf = ext === "pdf";
  const { size, error, previewUrl, watching } = useDocumentPreview(filePath, sourceSessionId, isPdf);

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
        <span
          style={{ fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          title={filePath}
        >
          {getRelativeFilePath(filePath, cwd)}
        </span>
        <span style={{ marginLeft: "auto" }}>{ext === "docx" ? t("docxPreview", "DOCX preview") : "PDF"}</span>
        {size != null && <span>{formatFileSize(size, language)}</span>}
        <DownloadLink filePath={filePath} sourceSessionId={sourceSessionId} />
        <WatchIndicator watching={watching} noShrink />
      </div>
      <div style={{ flex: 1, minHeight: 0, background: "var(--fx-surface-raised)" }}>
        {error ? (
          <div
            style={{
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
              color: "var(--fx-status-danger)",
              fontSize: "var(--text-body)",
              textAlign: "center",
            }}
          >
            {error}
          </div>
        ) : !previewUrl ? (
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
        ) : (
          <iframe
            key={previewUrl}
            src={previewUrl}
            sandbox={isPdf ? undefined : ""}
            title={t("filePreviewTitle", "Preview {name}").replace("{name}", getFileName(filePath))}
            style={{ width: "100%", height: "100%", border: "none", background: "var(--fx-surface-main)" }}
          />
        )}
      </div>
    </div>
  );
}
