import { useEffect, useMemo, useState, type ImgHTMLAttributes } from "react";
import { PRIMARY_ENVIRONMENT_ID, type EnvironmentId } from "@contract/environment";
import { resolveLocalFileHref } from "@/lib/file-links";
import { getFileName } from "@/lib/file-paths";
import { useI18n } from "@/i18n";
import { ExpandIcon } from "@/components/media-lightbox/media-lightbox-icons";
import { ImageLightbox } from "@/components/media-lightbox/image-lightbox";

function deriveImageFileName(
  localPath: string | null,
  src: string | undefined,
  alt: string | undefined,
): string | undefined {
  if (localPath) return getFileName(localPath);
  if (src && !src.startsWith("data:") && !src.startsWith("blob:")) {
    try {
      const parsed = new URL(src, "https://local.invalid");
      const base = parsed.pathname.split("/").filter(Boolean).pop();
      if (base) return decodeURIComponent(base);
    } catch {
      void 0;
    }
  }
  const trimmedAlt = alt?.trim();
  return trimmedAlt || undefined;
}

export function MarkdownImage({
  environmentId = PRIMARY_ENVIRONMENT_ID,
  src,
  alt,
  cwd,
  relativeBase,
  sourceSessionId,
  onLoad,
  onClick,
  ...props
}: ImgHTMLAttributes<HTMLImageElement> & {
  environmentId?: EnvironmentId;
  cwd?: string;
  relativeBase?: string;
  sourceSessionId?: string | null;
}) {
  const { t } = useI18n();
  const identity = JSON.stringify([environmentId, src, cwd, relativeBase, sourceSessionId]);
  const [loadedIdentity, setLoadedIdentity] = useState(identity);
  const localPath = useMemo(
    () => resolveLocalFileHref(typeof src === "string" ? src : undefined, cwd, relativeBase),
    [cwd, relativeBase, src],
  );
  const [previewSrc, setPreviewSrc] = useState<string | null>(localPath ? null : typeof src === "string" ? src : null);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  useEffect(() => {
    setLoadedIdentity(identity);
    setDimensions(null);
    setLightboxOpen(false);
    if (!localPath) {
      setPreviewSrc(typeof src === "string" ? src : null);
      setFileSize(null);
      setFailed(false);
      return;
    }

    let disposed = false;
    let revoke: (() => void) | null = null;
    setPreviewSrc(null);
    setFileSize(null);
    setFailed(false);

    void import("@/lib/file-blob")
      .then(({ fileToObjectUrl }) => fileToObjectUrl(environmentId, localPath, sourceSessionId))
      .then((result) => {
        if (disposed) {
          result.revoke();
          return;
        }
        revoke = result.revoke;
        setPreviewSrc(result.url);
        setFileSize(result.size);
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });

    return () => {
      disposed = true;
      revoke?.();
    };
  }, [environmentId, localPath, sourceSessionId, src, identity]);

  if (loadedIdentity !== identity) {
    return <span className="markdown-image-loading" aria-label={alt || t("loading", "Loading…")} />;
  }

  if (failed) {
    return (
      <span className="markdown-image-error" title={localPath ?? undefined}>
        {alt || t("imageLoadFailed", "Failed to load image")}
      </span>
    );
  }

  if (!previewSrc) {
    return <span className="markdown-image-loading" aria-label={alt || t("loading", "Loading…")} />;
  }

  const fileName = deriveImageFileName(localPath, typeof src === "string" ? src : undefined, alt);
  const expandLabel = t("expandPreview", "Expand");

  return (
    <span className="markdown-image-frame">
      <img
        src={previewSrc}
        alt={alt ?? ""}
        loading="lazy"
        referrerPolicy="no-referrer"
        onLoad={(event) => {
          const img = event.currentTarget;
          if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            setDimensions({ width: img.naturalWidth, height: img.naturalHeight });
          }
          onLoad?.(event);
        }}
        onClick={(event) => {
          onClick?.(event);
          if (event.defaultPrevented) return;
          if (event.currentTarget.closest("a")) return;
          setLightboxOpen(true);
        }}
        {...props}
      />
      <button
        type="button"
        className="markdown-image-expand type-meta-default"
        aria-label={expandLabel}
        title={expandLabel}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setLightboxOpen(true);
        }}
      >
        <ExpandIcon size={12} />
        <span>{expandLabel}</span>
      </button>
      {lightboxOpen && (
        <ImageLightbox
          src={previewSrc}
          alt={alt}
          fileName={fileName}
          fileSize={fileSize}
          initialDimensions={dimensions}
          localFile={localPath ? { environmentId, filePath: localPath, sourceSessionId } : undefined}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </span>
  );
}
