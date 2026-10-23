import type { TextFileData } from "@/lib/file-viewer-load-state";
import { getLanguageDisplayName } from "@/lib/file-types";
import { useI18n } from "@/i18n";
import { formatFileSize, formatNumber } from "@/lib/locale-format";
import type { DiffSummary } from "./use-text-file";

export type StatusMode = "source" | "diff" | "preview";

function lineEnding(content: string): string | null {
  const crlf = content.split("\r\n").length - 1;
  const lf = content.split("\n").length - 1 - crlf;
  if (crlf === 0 && lf === 0) return null;
  if (crlf === 0) return "LF";
  if (lf === 0) return "CRLF";
  return "CRLF + LF";
}

export function StatusBar({
  filePath,
  data,
  lineCount,
  mode,
  diffSummary,
}: {
  filePath: string;
  data: TextFileData;
  lineCount: number;
  mode: StatusMode;
  diffSummary: DiffSummary | null;
}) {
  const { language, t } = useI18n();
  const languageName = getLanguageDisplayName(filePath, data.language);
  const ending = lineEnding(data.content);
  const modeInfo =
    mode === "diff" && diffSummary
      ? t("diffHunkCount", "{count} changes").replace("{count}", formatNumber(diffSummary.hunks, language))
      : mode === "preview"
        ? t("readingView", "Reading view")
        : null;

  return (
    <div className="file-viewer-status">
      {languageName && <span className="type-meta-default">{languageName}</span>}
      <span className="type-mono-meta">
        {t("lineCount", "{count} lines").replace("{count}", formatNumber(lineCount, language))}
      </span>
      <span className="type-mono-meta">{formatFileSize(data.size, language)}</span>
      <span className="file-viewer-status-spacer" />
      <span className="type-mono-meta">{ending ? `UTF-8 \u00b7 ${ending}` : "UTF-8"}</span>
      {modeInfo && <span className="type-mono-meta">{modeInfo}</span>}
    </div>
  );
}
