import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import { formatFileSize } from "@/lib/locale-format";
import {
  copyPngBlobToClipboard,
  downloadMediaImage,
  imageElementToPngBlob,
  type LocalMediaFile,
} from "@/lib/media-export";
import { ZoomCanvas, type ZoomScene } from "@/components/zoom-canvas";
import { CheckIcon, DownloadIcon, ImageIcon } from "./media-lightbox-icons";
import { MediaLightboxDialog, MediaLightboxHeader, MediaLightboxHint } from "./media-lightbox-shell";

type CopyImageStatus = "idle" | "busy" | "copied" | "failed";

export function ImageLightbox({
  src,
  alt,
  fileName,
  fileSize,
  initialDimensions,
  localFile,
  onClose,
}: {
  src: string;
  alt?: string;
  fileName?: string;
  fileSize?: number | null;
  initialDimensions?: { width: number; height: number } | null;
  localFile?: LocalMediaFile;
  onClose: () => void;
}) {
  const { language, t } = useI18n();
  const titleId = useId();
  const memoryKey = useId();
  const imgRef = useRef<HTMLImageElement | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [decoded, setDecoded] = useState<{ width: number; height: number } | null>(initialDimensions ?? null);
  const [failed, setFailed] = useState(false);
  const [copyStatus, setCopyStatus] = useState<CopyImageStatus>("idle");
  const [downloading, setDownloading] = useState(false);

  const displayTitle = fileName || alt?.trim() || t("lightboxImageFallbackTitle", "Image");

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const scheduleResetCopy = useCallback(() => {
    if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => {
      copyTimerRef.current = null;
      setCopyStatus("idle");
    }, 1_500);
  }, []);

  const handleCopyImage = useCallback(async () => {
    const img = imgRef.current;
    if (!img || copyStatus === "busy") return;
    setCopyStatus("busy");
    try {
      const pngBlob = await imageElementToPngBlob(img);
      await copyPngBlobToClipboard(pngBlob);
      setCopyStatus("copied");
      scheduleResetCopy();
    } catch {
      setCopyStatus("failed");
      scheduleResetCopy();
    }
  }, [copyStatus, scheduleResetCopy]);

  const handleDownload = useCallback(async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadMediaImage({
        src,
        fileName: fileName || "image.png",
        localFile,
        imageElement: imgRef.current,
      });
    } catch {
      void 0;
    } finally {
      setDownloading(false);
    }
  }, [downloading, fileName, localFile, src]);

  const meta = useMemo(() => {
    const parts: string[] = [];
    if (decoded) parts.push(`${decoded.width} × ${decoded.height}`);
    if (typeof fileSize === "number" && Number.isFinite(fileSize) && fileSize >= 0) {
      parts.push(formatFileSize(fileSize, language));
    }
    return parts.length > 0 ? parts.join(" · ") : null;
  }, [decoded, fileSize, language]);

  const imageNode = (
    <img
      ref={imgRef}
      src={src}
      alt={alt ?? displayTitle}
      draggable={false}
      referrerPolicy="no-referrer"
      onLoad={(event) => {
        const img = event.currentTarget;
        setDecoded({ width: img.naturalWidth || 300, height: img.naturalHeight || 150 });
        setFailed(false);
      }}
      onError={() => {
        setDecoded(null);
        setFailed(true);
      }}
    />
  );

  const scene: ZoomScene = failed
    ? {
        kind: "failed",
        feedback: (
          <div className="media-lightbox-error type-body-default">{t("imageLoadFailed", "Failed to load image")}</div>
        ),
      }
    : decoded
      ? { kind: "ready", width: decoded.width, height: decoded.height, content: imageNode }
      : {
          kind: "pending",
          content: imageNode,
          feedback: <div className="type-body-default">{t("loading", "Loading…")}</div>,
        };

  const actions = (
    <>
      <button
        type="button"
        className={[
          "media-lightbox-btn",
          "type-label-default",
          copyStatus === "copied" ? "is-success" : "",
          copyStatus === "failed" ? "is-error" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        disabled={!decoded || failed || copyStatus === "busy"}
        onClick={() => void handleCopyImage()}
      >
        {copyStatus === "copied" ? <CheckIcon /> : <ImageIcon size={13} />}
        <span>
          {copyStatus === "copied"
            ? t("copied", "Copied")
            : copyStatus === "failed"
              ? t("copyFailed", "Copy failed")
              : t("copyImage", "Copy image")}
        </span>
      </button>
      <button
        type="button"
        className="media-lightbox-btn type-label-default"
        disabled={failed || downloading}
        onClick={() => void handleDownload()}
      >
        <DownloadIcon size={13} />
        <span>{t("downloadOriginalImage", "Download")}</span>
      </button>
    </>
  );

  return (
    <MediaLightboxDialog titleId={titleId} onClose={onClose}>
      <ZoomCanvas
        className="media-lightbox-zoom media-lightbox-zoom-image"
        memoryKey={memoryKey}
        label={t("zoomCanvasLabel", "Zoomable preview")}
        scene={scene}
        header={(controls) => (
          <MediaLightboxHeader
            titleId={titleId}
            icon={<ImageIcon />}
            title={displayTitle}
            meta={meta}
            center={controls}
            actions={actions}
            onClose={onClose}
          />
        )}
      />
      <MediaLightboxHint
        text={t(
          "lightboxShortcutHint",
          "Scroll to zoom · Drag to pan · Double-click to toggle fit / 100% · Esc to close",
        )}
      />
    </MediaLightboxDialog>
  );
}
