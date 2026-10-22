import type { TextFileData } from "@/lib/file-viewer-load-state";
import { useI18n } from "@/i18n";
import { formatNumber } from "@/lib/locale-format";
import type { TextViewMode } from "./use-text-file";

export interface TextModeTogglesProps {
  data: TextFileData;
  changeCount: number;
  hasDiff: boolean;
  viewMode: TextViewMode;
  setViewMode: (mode: TextViewMode) => void;
  previewMode: boolean;
  setPreviewMode: (preview: boolean) => void;
  wrapLines: boolean;
  setWrapLines: (update: (wrap: boolean) => boolean) => void;
}

export function TextModeToggles({
  data,
  changeCount,
  hasDiff,
  viewMode,
  setViewMode,
  previewMode,
  setPreviewMode,
  wrapLines,
  setWrapLines,
}: TextModeTogglesProps) {
  const { language, t } = useI18n();
  const isHtml = data.language === "html";
  const isMarkdown = data.language === "markdown";

  return (
    <>
      {hasDiff && (
        <div
          style={{
            display: "flex",
            borderRadius: "var(--radius-control)",
            overflow: "hidden",
            border: "1px solid var(--fx-line-default)",
          }}
        >
          <button
            type="button"
            onClick={() => setViewMode("source")}
            style={{
              minHeight: 32,
              padding: "0 12px",
              fontSize: "var(--text-label)",
              border: "none",
              cursor: "pointer",
              background: viewMode === "source" ? "var(--bg-selected)" : "var(--bg-hover)",
              color: viewMode === "source" ? "var(--fx-text-primary)" : "var(--fx-text-secondary)",
              fontWeight: viewMode === "source" ? 600 : 400,
            }}
          >
            {t("source", "Source")}
          </button>
          <button
            type="button"
            onClick={() => setViewMode("diff")}
            style={{
              minHeight: 32,
              padding: "0 12px",
              fontSize: "var(--text-label)",
              border: "none",
              borderLeft: "1px solid var(--fx-line-default)",
              cursor: "pointer",
              background: viewMode === "diff" ? "var(--bg-selected)" : "var(--bg-hover)",
              color: viewMode === "diff" ? "var(--fx-text-primary)" : "var(--fx-text-secondary)",
              fontWeight: viewMode === "diff" ? 600 : 400,
            }}
          >
            {t("diff", "Diff")}{" "}
            {changeCount > 0 && (
              <span style={{ color: "var(--fx-status-success)", marginLeft: 2 }}>
                +{formatNumber(changeCount, language)}
              </span>
            )}
          </button>
        </div>
      )}

      {viewMode === "source" && !previewMode && (
        <button
          type="button"
          onClick={() => setWrapLines((v) => !v)}
          title={wrapLines ? t("disableWordWrap", "Disable word wrap") : t("enableWordWrap", "Enable word wrap")}
          style={{
            minHeight: 32,
            padding: "0 12px",
            fontSize: "var(--text-label)",
            cursor: "pointer",
            background: wrapLines ? "var(--bg-selected)" : "var(--bg-hover)",
            color: wrapLines ? "var(--fx-text-primary)" : "var(--fx-text-secondary)",
            border: "1px solid var(--fx-line-default)",
            borderRadius: "var(--radius-control)",
            fontWeight: wrapLines ? 600 : 400,
          }}
        >
          {t("wrap", "wrap")}
        </button>
      )}

      {isHtml && viewMode === "source" && (
        <div
          style={{
            display: "flex",
            borderRadius: "var(--radius-control)",
            overflow: "hidden",
            border: "1px solid var(--fx-line-default)",
          }}
        >
          <button
            type="button"
            onClick={() => setPreviewMode(false)}
            style={{
              minHeight: 32,
              padding: "0 12px",
              fontSize: "var(--text-label)",
              border: "none",
              cursor: "pointer",
              background: !previewMode ? "var(--bg-selected)" : "var(--bg-hover)",
              color: !previewMode ? "var(--fx-text-primary)" : "var(--fx-text-secondary)",
              fontWeight: !previewMode ? 600 : 400,
            }}
          >
            {t("code", "Code")}
          </button>
          <button
            type="button"
            onClick={() => setPreviewMode(true)}
            style={{
              minHeight: 32,
              padding: "0 12px",
              fontSize: "var(--text-label)",
              border: "none",
              borderLeft: "1px solid var(--fx-line-default)",
              cursor: "pointer",
              background: previewMode ? "var(--bg-selected)" : "var(--bg-hover)",
              color: previewMode ? "var(--fx-text-primary)" : "var(--fx-text-secondary)",
              fontWeight: previewMode ? 600 : 400,
            }}
          >
            {t("preview", "Preview")}
          </button>
        </div>
      )}

      {isMarkdown && viewMode === "source" && (
        <div
          style={{
            display: "flex",
            borderRadius: "var(--radius-control)",
            overflow: "hidden",
            border: "1px solid var(--fx-line-default)",
          }}
        >
          <button
            type="button"
            onClick={() => setPreviewMode(true)}
            style={{
              minHeight: 32,
              padding: "0 12px",
              fontSize: "var(--text-label)",
              border: "none",
              cursor: "pointer",
              background: previewMode ? "var(--bg-selected)" : "var(--bg-hover)",
              color: previewMode ? "var(--fx-text-primary)" : "var(--fx-text-secondary)",
              fontWeight: previewMode ? 600 : 400,
            }}
          >
            {t("preview", "Preview")}
          </button>
          <button
            type="button"
            onClick={() => setPreviewMode(false)}
            style={{
              minHeight: 32,
              padding: "0 12px",
              fontSize: "var(--text-label)",
              border: "none",
              borderLeft: "1px solid var(--fx-line-default)",
              cursor: "pointer",
              background: !previewMode ? "var(--bg-selected)" : "var(--bg-hover)",
              color: !previewMode ? "var(--fx-text-primary)" : "var(--fx-text-secondary)",
              fontWeight: !previewMode ? 600 : 400,
            }}
          >
            {t("raw", "Raw")}
          </button>
        </div>
      )}
    </>
  );
}
