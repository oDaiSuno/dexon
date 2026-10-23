import { useLayoutEffect, useRef, useState } from "react";
import type { TextFileData } from "@/lib/file-viewer-load-state";
import { useI18n } from "@/i18n";
import { formatNumber } from "@/lib/locale-format";
import type { DiffSummary, TextViewMode } from "./use-text-file";

type ModeId = "source" | "diff" | "preview";

export interface TextModeTogglesProps {
  data: TextFileData;
  hasDiff: boolean;
  diffSummary: DiffSummary | null;
  viewMode: TextViewMode;
  setViewMode: (mode: TextViewMode) => void;
  previewMode: boolean;
  setPreviewMode: (preview: boolean) => void;
  wrapLines: boolean;
  setWrapLines: (update: (wrap: boolean) => boolean) => void;
}

export function TextModeToggles({
  data,
  hasDiff,
  diffSummary,
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
  const previewable = isHtml || isMarkdown;
  const sourceLabel = isHtml ? t("code", "Source") : isMarkdown ? t("raw", "Source") : t("source", "Source");
  const active: ModeId = viewMode === "diff" && hasDiff ? "diff" : previewable && previewMode ? "preview" : "source";

  const modes: { id: ModeId; label: string; select: () => void }[] = [
    {
      id: "source",
      label: sourceLabel,
      select: () => {
        setViewMode("source");
        setPreviewMode(false);
      },
    },
  ];
  if (hasDiff) modes.push({ id: "diff", label: t("diff", "Changes"), select: () => setViewMode("diff") });
  if (previewable) {
    modes.push({
      id: "preview",
      label: t("preview", "Preview"),
      select: () => {
        setViewMode("source");
        setPreviewMode(true);
      },
    });
  }

  const changes =
    diffSummary && `+${formatNumber(diffSummary.added, language)} \u2212${formatNumber(diffSummary.removed, language)}`;

  return (
    <>
      {modes.length > 1 && (
        <ModeSwitch
          modes={modes}
          active={active}
          layoutKey={`${modes.map((mode) => mode.label).join("|")}|${changes ?? ""}`}
          changes={changes}
        />
      )}
      {active === "source" && (
        <button
          type="button"
          className="file-viewer-icon-button"
          onClick={() => setWrapLines((v) => !v)}
          aria-label={t("wrap", "Word wrap")}
          aria-pressed={wrapLines}
          title={wrapLines ? t("disableWordWrap", "Disable word wrap") : t("enableWordWrap", "Enable word wrap")}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 6h18" />
            <path d="M3 12h15a3 3 0 1 1 0 6h-4" />
            <path d="m16 16-2 2 2 2" />
            <path d="M3 18h7" />
          </svg>
        </button>
      )}
    </>
  );
}

function ModeSwitch({
  modes,
  active,
  layoutKey,
  changes,
}: {
  modes: { id: ModeId; label: string; select: () => void }[];
  active: ModeId;
  layoutKey: string;
  changes: string | null;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  const [gliding, setGliding] = useState(false);
  const activeIndex = modes.findIndex((mode) => mode.id === active);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => {
      const button = root.querySelectorAll<HTMLElement>("[data-file-mode]")[activeIndex];
      if (!button || button.offsetWidth === 0) return;
      setPill((current) =>
        current?.left === button.offsetLeft && current.width === button.offsetWidth
          ? current
          : { left: button.offsetLeft, width: button.offsetWidth },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [activeIndex, layoutKey]);

  useLayoutEffect(() => {
    if (pill && !gliding) setGliding(true);
  }, [pill, gliding]);

  return (
    <div ref={rootRef} className="file-viewer-mode">
      {pill && (
        <span
          className={`file-viewer-mode-pill${gliding ? " file-viewer-mode-pill-gliding" : ""}`}
          style={{ width: pill.width, transform: `translateX(${pill.left}px)` }}
          aria-hidden="true"
        />
      )}
      {modes.map((mode) => {
        const selected = mode.id === active;
        return (
          <button
            key={mode.id}
            type="button"
            data-file-mode={mode.id}
            className={`file-viewer-mode-tab ${selected ? "type-label-medium" : "type-label-default"}`}
            aria-pressed={selected}
            onClick={mode.select}
          >
            {mode.label}
            {mode.id === "diff" && changes && (
              <span className="file-viewer-mode-changes type-mono-meta">{changes}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
