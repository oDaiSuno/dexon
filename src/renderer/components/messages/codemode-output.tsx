import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, FileText, ImageOff, Maximize2, X } from "lucide-react";
import type { EnvironmentId } from "@contract/environment";
import { useI18n } from "@/i18n";
import { useCopyFeedback } from "@/hooks/useCopyFeedback";
import { ZoomCanvas } from "../zoom-canvas";
import type { ToolCallBlockProps } from "./ToolCallBlock";
import type { codemodeToolDetail } from "./codemode-tool-detail";

type Presentation = ReturnType<typeof codemodeToolDetail>;
type ImageSize = { width: number; height: number };

export function CodemodeCopyButton({
  text,
  label,
  iconOnly = false,
}: {
  text: string;
  label: string;
  iconOnly?: boolean;
}) {
  const { t } = useI18n();
  const { copied, copy } = useCopyFeedback();
  const [failed, setFailed] = useState(false);
  const feedback = failed
    ? t("codemodeOutputCopyFailed", "Copy failed")
    : copied
      ? t("codemodeOutputCopied", "Copied")
      : "";
  return (
    <button
      type="button"
      className="chat-codemode-action type-meta-default"
      aria-label={feedback || label}
      title={feedback || label}
      disabled={!text}
      onClick={async () => setFailed(!(await copy(text)))}
    >
      {copied && !failed ? (
        <Check size={iconOnly ? 13 : 12} aria-hidden="true" />
      ) : (
        <Copy size={iconOnly ? 13 : 12} aria-hidden="true" />
      )}
      <span className={iconOnly ? "sr-only" : undefined} aria-live="polite">
        {feedback || label}
      </span>
    </button>
  );
}

export function CodemodeOutput({
  detail,
  environmentId,
  onOpenFile,
}: {
  detail: Presentation;
  environmentId?: EnvironmentId;
  onOpenFile?: ToolCallBlockProps["onOpenFile"];
}) {
  const { t } = useI18n();
  const titleId = useId();
  const path = detail.details.fullOutputPath;
  const hasText = detail.output.trim().length > 0;
  if (detail.lifecycle === "starting" || detail.lifecycle === "running" || (!hasText && !detail.images.length && !path))
    return null;
  const partial = detail.lifecycle === "cancelled" || detail.lifecycle === "error";
  return (
    <section className="chat-codemode-output flex flex-col gap-[var(--space-2)]" aria-labelledby={titleId}>
      <header className="chat-codemode-header">
        <h3 id={titleId} className="type-label-medium m-0 flex-1">
          {partial ? t("codemodePartialOutput", "Output produced before failure") : t("codemodeOutput", "Results")}
        </h3>
        {hasText && <CodemodeCopyButton text={detail.output} label={t("codemodeCopyOutput", "Copy output")} />}
      </header>
      {detail.images.length > 0 && (
        <div className="flex min-w-0 flex-col gap-[var(--space-3-5)]">
          {detail.images.map((image, index) => (
            <CodemodeImage key={`${index}:${image.src}`} image={image} number={index + 1} />
          ))}
        </div>
      )}
      {hasText && <pre className="chat-codemode-output-text type-mono-code">{detail.output}</pre>}
      {path && (
        <button
          type="button"
          className="chat-codemode-truncated type-label-default"
          disabled={!onOpenFile || !environmentId}
          title={path}
          onClick={() => {
            if (onOpenFile && environmentId) onOpenFile(path, environmentId);
          }}
        >
          <FileText size={14} aria-hidden="true" className="shrink-0" />
          <span>{t("codemodeTruncated", "Output truncated · full content saved")}</span>
          <span className="chat-codemode-full-output ml-auto">
            {t("codemodeOpenFullOutput", "Open full output in the right panel")} →
          </span>
        </button>
      )}
    </section>
  );
}

function CodemodeImage({ image, number }: { image: Presentation["images"][number]; number: number }) {
  const { t } = useI18n();
  const [size, setSize] = useState<ImageSize | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const label = t("codemodeImage", "Image {number}").replace("{number}", String(number));
  const enlarge = t("codemodeEnlarge", "Enlarge image");
  return (
    <figure className="m-0 flex min-w-0 items-center gap-[var(--space-3-5)]">
      {failed ? (
        <div
          className="chat-codemode-image-failed type-meta-default flex h-[74px] w-[128px] shrink-0 items-center justify-center gap-[var(--space-2)] p-[var(--space-2)]"
          role="status"
        >
          <ImageOff size={16} aria-hidden="true" />
          {t("codemodeImageFailed", "Image could not be loaded")}
        </div>
      ) : (
        <button
          type="button"
          className="chat-codemode-image flex h-[74px] w-[128px] shrink-0 items-center justify-center overflow-hidden p-0 enabled:cursor-zoom-in"
          aria-label={`${label} · ${enlarge}`}
          title={enlarge}
          disabled={!size}
          onClick={() => setOpen(true)}
        >
          <img
            src={image.src}
            alt={label}
            loading="lazy"
            draggable={false}
            className="block max-h-full max-w-full object-contain"
            onLoad={(event) =>
              setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })
            }
            onError={() => setFailed(true)}
          />
        </button>
      )}
      <figcaption className="flex min-w-0 flex-1 flex-col gap-[var(--space-1)]">
        <span className="type-mono-label-strong truncate text-[var(--fx-text-primary)]">{label}</span>
        {size && (
          <span className="chat-codemode-secondary type-meta-default">
            {size.width} × {size.height}
          </span>
        )}
      </figcaption>
      <button
        type="button"
        className="chat-codemode-action chat-codemode-enlarge type-label-medium"
        disabled={!size || failed}
        onClick={() => setOpen(true)}
      >
        {enlarge}
        <Maximize2 size={12} aria-hidden="true" />
      </button>
      {open && size && (
        <CodemodeImageLightbox src={image.src} label={label} size={size} onClose={() => setOpen(false)} />
      )}
    </figure>
  );
}

function CodemodeImageLightbox({
  src,
  label,
  size,
  onClose,
}: {
  src: string;
  label: string;
  size: ImageSize;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [failed, setFailed] = useState(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    closeRef.current?.focus();
    return () => {
      dialog?.close();
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
    };
  }, []);

  return createPortal(
    <dialog
      ref={dialogRef}
      className="chat-codemode-lightbox"
      aria-labelledby={titleId}
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <ZoomCanvas
        label={label}
        className="chat-codemode-lightbox-canvas"
        scene={
          failed
            ? {
                kind: "failed",
                feedback: (
                  <span className="type-body-default">{t("codemodeImageFailed", "Image could not be loaded")}</span>
                ),
              }
            : {
                kind: "ready",
                ...size,
                content: <img src={src} alt={label} draggable={false} onError={() => setFailed(true)} />,
              }
        }
        header={(controls) => (
          <header className="chat-codemode-header">
            <h2 id={titleId} className="type-label-medium m-0">
              {label}
            </h2>
            <span className="chat-codemode-secondary type-mono-meta">
              {size.width} × {size.height}
            </span>
            <span className="ml-auto">{controls}</span>
            <button
              ref={closeRef}
              type="button"
              className="chat-codemode-action type-label-default"
              aria-label={t("codemodeCloseImage", "Close image")}
              title={t("codemodeCloseImage", "Close image")}
              onClick={onClose}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </header>
        )}
      />
    </dialog>,
    document.body,
  );
}
