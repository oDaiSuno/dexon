import { useCallback, useState } from "react";
import { getFileName, getRelativeFilePath } from "@/lib/file-paths";
import { useI18n } from "@/i18n";
import { formatFileSize } from "@/lib/locale-format";
import { DownloadLink } from "./download-link";
import type { FileViewerProps } from "./types";
import { useBlobSrc } from "./use-blob-src";
import { useFileWatch } from "./use-file-watch";
import { WatchIndicator } from "./watch-indicator";

export function ImageViewer({ filePath, cwd, sourceSessionId }: FileViewerProps) {
  const { language, t } = useI18n();
  const [bust, setBust] = useState(0);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const { src, size, error, setError, setSize } = useBlobSrc(filePath, sourceSessionId, bust);
  const onChange = useCallback(
    (s?: number) => {
      if (typeof s === "number") setSize(s);
      setNaturalSize(null);
      setBust((b) => b + 1);
    },
    [setSize],
  );
  const watching = useFileWatch(filePath, sourceSessionId, onChange);

  const ext = getFileName(filePath).toLowerCase().split(".").pop() ?? "";

  const formatSizeStr = size != null ? formatFileSize(size, language) : null;

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
        <span style={{ marginLeft: "auto" }}>{ext || "image"}</span>
        {naturalSize && (
          <span>
            {naturalSize.w} × {naturalSize.h}
          </span>
        )}
        {formatSizeStr && <span>{formatSizeStr}</span>}
        <WatchIndicator watching={watching} />
        <DownloadLink filePath={filePath} sourceSessionId={sourceSessionId} />
      </div>
      <div
        style={{
          flex: 1,
          overflow: "auto",
          background: "var(--fx-surface-raised)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
          backgroundImage:
            "linear-gradient(45deg, var(--fx-surface-main) 25%, transparent 25%), linear-gradient(-45deg, var(--fx-surface-main) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--fx-surface-main) 75%), linear-gradient(-45deg, transparent 75%, var(--fx-surface-main) 75%)",
          backgroundSize: "16px 16px",
          backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
        }}
      >
        {error ? (
          <div style={{ color: "var(--fx-status-danger)", fontSize: "var(--text-body)" }}>{error}</div>
        ) : !src ? (
          <div style={{ color: "var(--fx-text-secondary)", fontSize: "var(--text-body)" }}>
            {t("loading", "Loading…")}
          </div>
        ) : (
          <img
            src={src}
            alt={filePath}
            onLoad={(e) => {
              const img = e.currentTarget;
              setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
            }}
            onError={() => setError(t("imageLoadFailed", "Failed to load image"))}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
              boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            }}
          />
        )}
      </div>
    </div>
  );
}
