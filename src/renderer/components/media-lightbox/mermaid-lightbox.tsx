import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import { useCopyFeedback } from "@/hooks/useCopyFeedback";
import { formatNumber } from "@/lib/locale-format";
import {
  copyPngBlobToClipboard,
  extractMermaidLabel,
  measureSvgDimensions,
  prepareSvgForExport,
  sanitizeExportFileName,
  savePngBlob,
  saveSvgText,
  scopeSvgIds,
  svgToPngBlob,
} from "@/lib/media-export";
import { CodeLines } from "@/components/markdown/code-lines";
import { ZoomCanvas, type ZoomScene } from "@/components/zoom-canvas";
import { CheckIcon, ChevronDownIcon, CopyIcon, DiagramIcon, DownloadIcon, ImageIcon } from "./media-lightbox-icons";
import { MediaLightboxDialog, MediaLightboxHeader, MediaLightboxHint } from "./media-lightbox-shell";

type MermaidLightboxMode = "preview" | "source";
type CopyImageStatus = "idle" | "busy" | "copied" | "failed";

function resolveThemeSurfaceBackground(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const value = getComputedStyle(document.documentElement).getPropertyValue("--fx-surface-raised").trim();
  return value || undefined;
}

export function MermaidLightbox({ code, svg, onClose }: { code: string; svg: string; onClose: () => void }) {
  const { language, t } = useI18n();
  const titleId = useId();
  const memoryKey = useId();
  const [mode, setMode] = useState<MermaidLightboxMode>("preview");
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [copyImageStatus, setCopyImageStatus] = useState<CopyImageStatus>("idle");
  const { copied: sourceCopied, copy: copySource } = useCopyFeedback();
  const exportWrapRef = useRef<HTMLDivElement>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewModeBtnRef = useRef<HTMLButtonElement>(null);
  const sourceModeBtnRef = useRef<HTMLButtonElement>(null);
  const focusAfterModeSwitchRef = useRef(false);

  const label = useMemo(() => extractMermaidLabel(code), [code]);
  const dimensions = useMemo(() => measureSvgDimensions(svg), [svg]);
  const lineCount = useMemo(() => code.split("\n").length, [code]);

  useEffect(() => {
    if (!focusAfterModeSwitchRef.current) return;
    focusAfterModeSwitchRef.current = false;
    const target = mode === "preview" ? previewModeBtnRef.current : sourceModeBtnRef.current;
    target?.focus({ preventScroll: true });
  }, [mode]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!exportMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!exportWrapRef.current?.contains(event.target as Node)) setExportMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [exportMenuOpen]);

  const scheduleResetCopyImage = useCallback(() => {
    if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => {
      copyTimerRef.current = null;
      setCopyImageStatus("idle");
    }, 1_500);
  }, []);

  const handleCopyImage = useCallback(async () => {
    if (copyImageStatus === "busy") return;
    setCopyImageStatus("busy");
    try {
      const pngBlob = await svgToPngBlob(svg, {
        scale: 2,
        backgroundColor: resolveThemeSurfaceBackground(),
      });
      await copyPngBlobToClipboard(pngBlob);
      setCopyImageStatus("copied");
      scheduleResetCopyImage();
    } catch {
      setCopyImageStatus("failed");
      scheduleResetCopyImage();
    }
  }, [copyImageStatus, scheduleResetCopyImage, svg]);

  const handleExportPng = useCallback(async () => {
    setExportMenuOpen(false);
    if (exportBusy) return;
    setExportBusy(true);
    try {
      const pngBlob = await svgToPngBlob(svg, {
        scale: 2,
        backgroundColor: resolveThemeSurfaceBackground(),
      });
      await savePngBlob(pngBlob, sanitizeExportFileName(label, "png"));
    } catch {
      void 0;
    } finally {
      setExportBusy(false);
    }
  }, [exportBusy, label, svg]);

  const handleExportSvg = useCallback(async () => {
    setExportMenuOpen(false);
    if (exportBusy) return;
    setExportBusy(true);
    try {
      await saveSvgText(prepareSvgForExport(svg, dimensions), sanitizeExportFileName(label, "svg"));
    } catch {
      void 0;
    } finally {
      setExportBusy(false);
    }
  }, [dimensions, exportBusy, label, svg]);

  const handleBeforeEscape = useCallback(() => {
    if (!exportMenuOpen) return false;
    setExportMenuOpen(false);
    return true;
  }, [exportMenuOpen]);

  const meta =
    mode === "preview"
      ? t("mermaidVectorMeta", "Vector · {width} × {height}")
          .replace("{width}", String(dimensions.width))
          .replace("{height}", String(dimensions.height))
      : t("mermaidSourceMeta", "Source · {lines} · Word wrap").replace(
          "{lines}",
          t("lineCount", "{count} lines").replace("{count}", formatNumber(lineCount, language)),
        );

  const modeSwitch = (
    <div
      className="media-lightbox-segmented"
      role="group"
      aria-label={t("mermaidDiagramViewMode", "Diagram view mode")}
    >
      <button
        ref={previewModeBtnRef}
        type="button"
        className={`media-lightbox-seg-btn ${mode === "preview" ? "is-active type-label-medium" : "type-label-default"}`}
        aria-pressed={mode === "preview"}
        onClick={() => {
          setExportMenuOpen(false);
          if (mode !== "preview") {
            focusAfterModeSwitchRef.current = true;
            setMode("preview");
          }
        }}
      >
        {t("preview", "Preview")}
      </button>
      <button
        ref={sourceModeBtnRef}
        type="button"
        className={`media-lightbox-seg-btn ${mode === "source" ? "is-active type-label-medium" : "type-label-default"}`}
        aria-pressed={mode === "source"}
        onClick={() => {
          setExportMenuOpen(false);
          if (mode !== "source") {
            focusAfterModeSwitchRef.current = true;
            setMode("source");
          }
        }}
      >
        {t("source", "Source")}
      </button>
    </div>
  );

  const copySourceButton = (
    <button
      type="button"
      className={["media-lightbox-btn", "type-label-default", sourceCopied ? "is-success" : ""]
        .filter(Boolean)
        .join(" ")}
      onClick={() => void copySource(code)}
    >
      {sourceCopied ? <CheckIcon /> : <CopyIcon size={13} />}
      <span>{sourceCopied ? t("copied", "Copied") : t("copySource", "Copy source")}</span>
    </button>
  );

  const previewActions = (
    <>
      {modeSwitch}
      <button
        type="button"
        className={[
          "media-lightbox-btn",
          "type-label-default",
          copyImageStatus === "copied" ? "is-success" : "",
          copyImageStatus === "failed" ? "is-error" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        disabled={copyImageStatus === "busy"}
        onClick={() => void handleCopyImage()}
      >
        {copyImageStatus === "copied" ? <CheckIcon /> : <ImageIcon size={13} />}
        <span>
          {copyImageStatus === "copied"
            ? t("copied", "Copied")
            : copyImageStatus === "failed"
              ? t("copyFailed", "Copy failed")
              : t("copyImage", "Copy image")}
        </span>
      </button>
      <div ref={exportWrapRef} className="media-lightbox-export">
        <button
          type="button"
          className="media-lightbox-btn type-label-default"
          aria-haspopup="menu"
          aria-expanded={exportMenuOpen}
          disabled={exportBusy}
          onClick={() => setExportMenuOpen((open) => !open)}
        >
          <DownloadIcon size={13} />
          <span>{t("exportDiagram", "Export PNG / SVG")}</span>
          <ChevronDownIcon />
        </button>
        {exportMenuOpen && (
          <div className="media-lightbox-export-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              className="media-lightbox-export-item type-label-default"
              onClick={() => void handleExportPng()}
            >
              {t("exportPng", "Export PNG (2×)")}
            </button>
            <button
              type="button"
              role="menuitem"
              className="media-lightbox-export-item type-label-default"
              onClick={() => void handleExportSvg()}
            >
              {t("exportSvg", "Export SVG")}
            </button>
          </div>
        )}
      </div>
      {copySourceButton}
    </>
  );

  const sourceActions = (
    <>
      {modeSwitch}
      {copySourceButton}
    </>
  );

  const scopedSvg = useMemo(() => scopeSvgIds(svg, "lightbox"), [svg]);

  const scene: ZoomScene = useMemo(
    () => ({
      kind: "ready",
      width: dimensions.width + 32,
      height: dimensions.height + 32,
      content: <div className="media-lightbox-svg-host" dangerouslySetInnerHTML={{ __html: scopedSvg }} />,
    }),
    [dimensions.height, dimensions.width, scopedSvg],
  );

  return (
    <MediaLightboxDialog titleId={titleId} onClose={onClose} onBeforeEscape={handleBeforeEscape}>
      {mode === "preview" ? (
        <>
          <ZoomCanvas
            className="media-lightbox-zoom"
            memoryKey={memoryKey}
            label={t("zoomCanvasLabel", "Zoomable preview")}
            scene={scene}
            header={(controls) => (
              <MediaLightboxHeader
                titleId={titleId}
                icon={<DiagramIcon />}
                title={label}
                meta={meta}
                center={controls}
                actions={previewActions}
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
        </>
      ) : (
        <>
          <MediaLightboxHeader
            titleId={titleId}
            icon={<DiagramIcon />}
            title={label}
            meta={meta}
            actions={sourceActions}
            onClose={onClose}
          />
          <div className="media-lightbox-source-stage">
            <div className="media-lightbox-source-card">
              <CodeLines code={code} lang="mermaid" wrapLines />
            </div>
          </div>
        </>
      )}
    </MediaLightboxDialog>
  );
}
