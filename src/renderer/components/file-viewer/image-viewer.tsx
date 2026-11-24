import { qualifyProjectKey } from "@contract/environment";
import { useCallback, useState } from "react";
import { getFileName, getRelativeFilePath } from "@/lib/file-paths";
import { useI18n } from "@/i18n";
import { formatFileSize } from "@/lib/locale-format";
import { ZoomCanvas, type ZoomScene } from "../zoom-canvas";
import { DownloadLink } from "./download-link";
import type { FileViewerProps } from "./types";
import { useBlobSrc } from "./use-blob-src";
import { useFileWatch } from "./use-file-watch";
import { WatchIndicator } from "./watch-indicator";

export function ImageViewer({ filePath, cwd, sourceSessionId, environmentId }: FileViewerProps) {
  const { language, t } = useI18n();
  const [bust, setBust] = useState(0);
  const [decoded, setDecoded] = useState<{ width: number; height: number } | null>(null);
  const { src, size, error, setError, setSize } = useBlobSrc(environmentId, filePath, sourceSessionId, bust);
  const onChange = useCallback(
    (s?: number) => {
      if (typeof s === "number") setSize(s);
      setBust((b) => b + 1);
    },
    [setSize],
  );
  const watching = useFileWatch(environmentId, filePath, sourceSessionId, onChange);
  if ((error || !src) && decoded) setDecoded(null);
  const ext = getFileName(filePath).toLowerCase().split(".").pop() ?? "";
  const image = src ? (
    <img
      src={src}
      alt={filePath}
      draggable={false}
      onLoad={(e) => {
        const img = e.currentTarget;
        if (img.currentSrc === src) setDecoded({ width: img.naturalWidth || 300, height: img.naturalHeight || 150 });
      }}
      onError={(e) => {
        if (e.currentTarget.currentSrc !== src) return;
        setDecoded(null);
        setError(t("imageLoadFailed", "Failed to load image"));
      }}
    />
  ) : null;
  const scene: ZoomScene = error
    ? { kind: "failed", feedback: <div className="image-viewer-error type-body-default">{error}</div> }
    : decoded
      ? { kind: "ready", ...decoded, content: image }
      : {
          kind: "pending",
          content: image,
          feedback: <div className="type-body-default">{t("loading", "Loading…")}</div>,
        };

  return (
    <ZoomCanvas
      className="image-viewer"
      memoryKey={qualifyProjectKey(environmentId, filePath)}
      label={t("zoomCanvasLabel", "Zoomable preview")}
      scene={scene}
      header={(controls) => (
        <div className="file-viewer-meta image-viewer-meta type-mono-meta">
          <span className="file-viewer-crumbs image-viewer-path" title={filePath}>
            {getRelativeFilePath(filePath, cwd)}
          </span>
          <span className="image-viewer-secondary">
            <span>{ext || "image"}</span>
            {decoded && (
              <span>
                {decoded.width} × {decoded.height}
              </span>
            )}
            {size != null && <span>{formatFileSize(size, language)}</span>}
          </span>
          {controls}
          <WatchIndicator watching={watching} />
          <DownloadLink environmentId={environmentId} filePath={filePath} sourceSessionId={sourceSessionId} />
        </div>
      )}
    />
  );
}
