import type { CSSProperties, RefObject } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/i18n";
import type { ModelCatalogStatus } from "@contract/types";
import { CheckmarkIcon, ChevronDownIcon, Icon } from "./icons";
import { CLEAR, HOVER, paint, QUICK } from "./menu-chrome";

export interface ModelOption {
  provider: string;
  modelId: string;
  name: string;
}

const ROW: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  height: 34,
  flexShrink: 0,
  border: "none",
  borderRadius: "var(--radius-control)",
  cursor: "pointer",
  textAlign: "left",
  whiteSpace: "nowrap",
  transition: `background ${QUICK}`,
};

function PlugsIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 256 256" fill="currentColor" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path
        opacity={0.3}
        d="M185,127,127,185a24,24,0,0,1-33.94,0L71,162.91A24,24,0,0,1,71,129L129,71a24,24,0,0,1,33.94,0L185,93.09A24,24,0,0,1,185,127Z"
      />
      <path d="M237.66,18.34a8,8,0,0,0-11.32,0l-52.4,52.41-5.37-5.38a32.05,32.05,0,0,0-45.26,0L100,88.69l-6.34-6.35A8,8,0,0,0,82.34,93.66L88.69,100,65.37,123.31a32,32,0,0,0,0,45.26l5.38,5.37-52.41,52.4a8,8,0,0,0,11.32,11.32l52.4-52.41,5.37,5.38a32,32,0,0,0,45.26,0L156,167.31l6.34,6.35a8,8,0,0,0,11.32-11.32L167.31,156l23.32-23.31a32,32,0,0,0,0-45.26l-5.38-5.37,52.41-52.4A8,8,0,0,0,237.66,18.34Zm-116.29,161a16,16,0,0,1-22.62,0L76.69,157.25a16,16,0,0,1,0-22.62L100,111.31,144.69,156Zm57.94-57.94L156,144.69,111.31,100l23.32-23.31a16,16,0,0,1,22.62,0l22.06,22A16,16,0,0,1,179.31,121.37ZM88.57,35A8,8,0,0,1,103.43,29l8,20A8,8,0,0,1,96.57,55ZM24.57,93A8,8,0,0,1,35,88.57l20,8A8,8,0,0,1,49,111.43l-20-8A8,8,0,0,1,24.57,93ZM231.43,163a8,8,0,0,1-10.4,4.46l-20-8A8,8,0,1,1,207,144.57l20,8A8,8,0,0,1,231.43,163Zm-64,58.06A8,8,0,0,1,152.57,227l-8-20A8,8,0,0,1,159.43,201Z" />
    </svg>
  );
}

const MODEL_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function compareModelOptions(a: ModelOption, b: ModelOption): number {
  return (
    MODEL_COLLATOR.compare(a.name || a.modelId, b.name || b.modelId) ||
    MODEL_COLLATOR.compare(a.provider, b.provider) ||
    MODEL_COLLATOR.compare(a.modelId, b.modelId)
  );
}

/** Session model picker chip (below the composer) + its portal dropdown. */
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
}: {
  model: { provider: string; modelId: string } | null | undefined;
  modelsByProvider: { provider: string; options: ModelOption[] }[];
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
}) {
  const { t } = useI18n();
  const showPicker = Boolean(onModelsRefresh || (modelsByProvider.length > 0 && currentName && onModelChange));
  if (!showPicker) return null;

  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  const bottom = viewportHeight - (dropdownRect?.top ?? 0) + 6;
  const maxH = Math.max(120, Math.min((dropdownRect?.top ?? 0) - 8, viewportHeight * 0.6));
  const panelPos: CSSProperties = isMobile
    ? { left: 8, right: 8, maxWidth: "calc(100vw - 16px)" }
    : { left: dropdownRect?.left ?? 0, width: "max-content", minWidth: Math.max(dropdownRect?.width ?? 0, 320) };

  return (
    <div ref={containerRef} style={{ position: "relative", minWidth: 0 }}>
      <button
        ref={buttonRef}
        type="button"
        onClick={onToggle}
        disabled={isStreaming}
        aria-haspopup="listbox"
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
          <PlugsIcon />
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
          <div
            ref={panelRef}
            className="chat-appearance-scope composer-pop-in"
            style={{
              position: "fixed",
              bottom,
              transformOrigin: "bottom center",
              ...panelPos,
              zIndex: 500,
              boxSizing: "border-box",
              background: "var(--fx-surface-raised)",
              border: "1px solid var(--fx-line-default)",
              borderRadius: "var(--radius-composer)",
              boxShadow: "var(--shadow-picker)",
              overflow: "hidden",
              maxHeight: maxH,
              overflowY: "auto",
            }}
          >
            {onModelsRefresh && (
              <div
                style={{
                  padding: "var(--space-1) var(--space-2)",
                  borderBottom: "1px solid var(--fx-line-default)",
                  minWidth: 240,
                }}
              >
                <button
                  type="button"
                  disabled={modelRefreshing}
                  onClick={() => void onModelsRefresh?.()}
                  className="type-label-default"
                  style={{
                    ...ROW,
                    height: 30,
                    gap: 6,
                    padding: "0 var(--space-2)",
                    background: CLEAR,
                    color: "var(--fx-text-tertiary)",
                    cursor: modelRefreshing ? "wait" : "pointer",
                  }}
                  onMouseEnter={(e) => !modelRefreshing && paint(e, HOVER)}
                  onMouseLeave={(e) => paint(e, CLEAR)}
                >
                  <Icon size={13} strokeWidth={1.75}>
                    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                    <path d="M21 3v5h-5" />
                    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                    <path d="M8 16H3v5" />
                  </Icon>
                  {modelRefreshing
                    ? t("refreshingModels", "Refreshing model directory…")
                    : t("refreshModels", "Refresh model directory")}
                </button>
                {modelCatalog?.source === "offline" && (
                  <div
                    className="type-meta-default"
                    style={{ padding: "var(--space-1) var(--space-2)", color: "var(--fx-text-tertiary)" }}
                  >
                    {t("modelsOfflineCache", "Offline: using the cached model directory.")}
                  </div>
                )}
                {(modelCatalog?.warnings ?? []).map((warning) => (
                  <div
                    key={`${warning.provider}:${warning.code}`}
                    role="alert"
                    className="type-meta-default"
                    style={{
                      padding: "var(--space-1) var(--space-2)",
                      color: "var(--fx-status-warning-text)",
                      whiteSpace: "normal",
                    }}
                  >
                    {warning.message}
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 1, padding: 6 }}>
              {modelsByProvider.map((group, gi) => (
                <div key={group.provider} style={{ display: "contents" }}>
                  {gi > 0 && <div style={{ height: 1, flexShrink: 0, background: "var(--fx-surface-selected)" }} />}
                  {modelsByProvider.length > 1 && (
                    <div
                      className="type-label-medium"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        height: 28,
                        flexShrink: 0,
                        boxSizing: "border-box",
                        padding: "var(--space-1) var(--space-2) 0",
                        color: "var(--fx-text-tertiary)",
                      }}
                    >
                      {group.provider}
                    </div>
                  )}
                  {group.options.map((opt) => {
                    const isActive = opt.modelId === model?.modelId && opt.provider === model?.provider;
                    const rest = isActive ? "var(--fx-surface-selected)" : CLEAR;
                    return (
                      <button
                        key={`${opt.provider}:${opt.modelId}`}
                        onClick={() => onModelPick(opt.provider, opt.modelId, isActive)}
                        className="type-body-default"
                        style={{
                          ...ROW,
                          padding: `0 10px 0 ${modelsByProvider.length > 1 ? 29 : 10}px`,
                          background: rest,
                          color: isActive ? "var(--fx-text-primary)" : "var(--fx-text-secondary)",
                        }}
                        onMouseEnter={(e) => !isActive && paint(e, HOVER)}
                        onMouseLeave={(e) => paint(e, rest)}
                      >
                        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                          {opt.name}
                        </span>
                        <span
                          style={{ display: "flex", width: 14, flexShrink: 0, color: "var(--fx-accent-blue-text)" }}
                        >
                          {isActive && <CheckmarkIcon size={14} strokeWidth={2.25} />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
