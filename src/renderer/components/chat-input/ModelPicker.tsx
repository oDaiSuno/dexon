import type { CSSProperties, RefObject } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/i18n";
import type { ModelCatalogStatus } from "@contract/types";
import { ChevronDownIcon, PlugsConnectedIcon } from "./icons";
import { CLEAR, HOVER, paint, QUICK } from "./menu-chrome";
import type { ModelGroup } from "./model-catalog";
import { ModelPickerCard } from "./model-picker-card";

export function ModelPicker({
  model,
  modelsByProvider,
  currentName,
  isMobile,
  isStreaming,
  dropdownOpen,
  onToggle,
  buttonRef,
  containerRef,
  panelRef,
  dropdownRect,
  modelCatalog,
  modelRefreshing,
  onModelChange,
  onModelsRefresh,
  onModelPick,
  onClose,
  onManageModels,
}: {
  model: { provider: string; modelId: string } | null | undefined;
  modelsByProvider: ModelGroup[];
  currentName: string | null;
  isMobile: boolean;
  isStreaming: boolean;
  dropdownOpen: boolean;
  onToggle: () => void;
  buttonRef: RefObject<HTMLButtonElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
  dropdownRect: { top: number; left: number; width: number } | null;
  modelCatalog?: ModelCatalogStatus;
  modelRefreshing?: boolean;
  onModelChange?: (provider: string, modelId: string) => void;
  onModelsRefresh?: () => Promise<void> | void;
  onModelPick: (provider: string, modelId: string, isActive: boolean) => void;
  onClose: () => void;
  onManageModels?: () => void;
}) {
  const { t } = useI18n();
  const showPicker = Boolean(onModelsRefresh || (modelsByProvider.length > 0 && currentName && onModelChange));
  if (!showPicker) return null;

  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  const bottom = viewportHeight - (dropdownRect?.top ?? 0) + 6;
  const maxHeight = Math.max(160, (dropdownRect?.top ?? 0) - 8);
  const panelPos: CSSProperties = isMobile
    ? { left: 8, right: 8, maxWidth: "calc(100vw - 16px)" }
    : { left: dropdownRect?.left ?? 0, width: 320 };

  return (
    <div ref={containerRef} style={{ position: "relative", minWidth: 0 }}>
      <button
        ref={buttonRef}
        type="button"
        onClick={onToggle}
        disabled={isStreaming}
        aria-haspopup="dialog"
        aria-expanded={dropdownOpen}
        className="type-mono-label"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          justifyContent: isMobile ? "flex-start" : undefined,
          padding: isMobile ? "var(--space-2) 10px" : "0 var(--space-2)",
          minHeight: 30,
          width: isMobile ? "100%" : undefined,
          maxWidth: isMobile ? "100%" : 220,
          overflow: "hidden",
          background: dropdownOpen ? HOVER : CLEAR,
          border: "none",
          borderRadius: "var(--radius-control)",
          color: "var(--fx-text-primary)",
          cursor: isStreaming ? "not-allowed" : "pointer",
          opacity: isStreaming ? 0.5 : 1,
          transition: `background ${QUICK}`,
        }}
        onMouseEnter={(e) => !isStreaming && paint(e, HOVER)}
        onMouseLeave={(e) => paint(e, dropdownOpen ? HOVER : CLEAR)}
      >
        <span style={{ display: "flex", color: "var(--fx-text-secondary)" }}>
          <PlugsConnectedIcon size={14} />
        </span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
          {currentName ?? t("models", "Models")}
        </span>
        <span style={{ color: "var(--fx-text-tertiary)", display: "flex", flexShrink: 0 }}>
          <ChevronDownIcon size={12} />
        </span>
      </button>
      {dropdownOpen &&
        dropdownRect &&
        createPortal(
          <ModelPickerCard
            panelRef={panelRef}
            buttonRef={buttonRef}
            style={{ bottom, maxHeight, ...panelPos }}
            model={model}
            groups={modelsByProvider}
            modelCatalog={modelCatalog}
            modelRefreshing={modelRefreshing}
            onModelsRefresh={onModelsRefresh}
            onManageModels={onManageModels}
            onModelPick={onModelPick}
            onClose={onClose}
          />,
          document.body,
        )}
    </div>
  );
}
