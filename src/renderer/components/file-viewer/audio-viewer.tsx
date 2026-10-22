import { useCallback, useState } from "react";
import { getFileName, getRelativeFilePath } from "@/lib/file-paths";
import { useI18n } from "@/i18n";
import { formatFileSize } from "@/lib/locale-format";
import { DownloadLink } from "./download-link";
import type { FileViewerProps } from "./types";
import { useBlobSrc } from "./use-blob-src";
import { useFileWatch } from "./use-file-watch";
import { WatchIndicator } from "./watch-indicator";

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "";
  const totalSeconds = Math.round(seconds);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export function AudioViewer({ filePath, cwd, sourceSessionId }: FileViewerProps) {
  const { language, t } = useI18n();
  const [bust, setBust] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);
  const { src, size, error, setError, setSize } = useBlobSrc(filePath, sourceSessionId, bust);
  const onChange = useCallback(
    (s?: number) => {
      if (typeof s === "number") setSize(s);
      setDuration(null);
      setError(null);
      setBust((b) => b + 1);
    },
    [setSize, setError],
  );
  const watching = useFileWatch(filePath, sourceSessionId, onChange);

  const ext = getFileName(filePath).toLowerCase().split(".").pop() ?? "";

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
        <span style={{ marginLeft: "auto" }}>{ext || "audio"}</span>
        {duration != null && <span>{formatDuration(duration)}</span>}
        {size != null && <span>{formatFileSize(size, language)}</span>}
        <WatchIndicator watching={watching} />
        <DownloadLink filePath={filePath} sourceSessionId={sourceSessionId} />
      </div>
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          background: "var(--fx-surface-raised)",
        }}
      >
        <div style={{ width: "min(680px, 100%)" }}>
          {error && (
            <div
              style={{
                color: "var(--fx-status-danger)",
                fontSize: "var(--text-body)",
                marginBottom: 12,
                textAlign: "center",
              }}
            >
              {error}
            </div>
          )}
          {src && (
            <audio
              key={src}
              controls
              preload="metadata"
              src={src}
              onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
              onError={() => setError(t("audioLoadFailed", "Failed to load audio"))}
              style={{ width: "100%" }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
