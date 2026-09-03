import type { CSSProperties, RefObject } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/i18n";
import { scaledChatFont } from "@/lib/chat-appearance";
import type { ModelCatalogStatus } from "@contract/types";
import { CheckIcon, ChevronDownIcon, CpuIcon } from "./icons";

export interface ModelOption {
  provider: string;
  modelId: string;
  name: string;
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
    : { left: dropdownRect?.left ?? 0, width: "max-content", minWidth: dropdownRect?.width };

  return (
    <div ref={containerRef} style={{ position: "relative", minWidth: 0 }}>
      <button
        ref={buttonRef}
        type="button"
        onClick={onToggle}
        disabled={isStreaming}
        aria-haspopup="listbox"
        aria-expanded={dropdownOpen}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          justifyContent: isMobile ? "flex-start" : undefined,
          padding: isMobile ? "8px 10px" : "0 10px",
          minHeight: 32,
          width: isMobile ? "100%" : undefined,
          maxWidth: isMobile ? "100%" : 220,
          overflow: "hidden",
          background: dropdownOpen ? "var(--bg-selected)" : "transparent",
          border: "none",
          borderRadius: "var(--radius-control)",
          color: "var(--text-muted)",
          cursor: isStreaming ? "not-allowed" : "pointer",
          fontSize: scaledChatFont(12),
          opacity: isStreaming ? 0.5 : 1,
          transition: "background 0.12s, color 0.12s",
        }}
        onMouseEnter={(e) => {
          if (isStreaming) return;
          e.currentTarget.style.background = "var(--bg-hover)";
          e.currentTarget.style.color = "var(--text)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = dropdownOpen ? "var(--bg-selected)" : "transparent";
          e.currentTarget.style.color = "var(--text-muted)";
        }}
      >
        <CpuIcon size={11} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
          {currentName ?? t("models", "Models")}
        </span>
        <span style={{ color: "var(--text-dim)", display: "flex" }}>
          <ChevronDownIcon size={11} />
        </span>
      </button>
      {dropdownOpen &&
        dropdownRect &&
        createPortal(
          <div
            ref={panelRef}
            className="chat-appearance-scope"
            style={{
              position: "fixed",
              bottom,
              ...panelPos,
              zIndex: 500,
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-card)",
              boxShadow: "0 -4px 16px rgba(0,0,0,0.10)",
              overflow: "hidden",
              maxHeight: maxH,
              overflowY: "auto",
            }}
          >
            {onModelsRefresh && (
              <div
                style={{
                  padding: "8px 8px",
                  borderBottom: "1px solid var(--border)",
                  minWidth: 240,
                }}
              >
                <button
                  type="button"
                  disabled={modelRefreshing}
                  onClick={() => void onModelsRefresh?.()}
                  style={{
                    width: "100%",
                    padding: "8px 8px",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-control)",
                    background: "var(--bg-panel)",
                    color: "var(--text)",
                    cursor: modelRefreshing ? "wait" : "pointer",
                    fontSize: scaledChatFont(12),
                    textAlign: "left",
                  }}
                >
                  {modelRefreshing
                    ? t("refreshingModels", "Refreshing model directory…")
                    : t("refreshModels", "Refresh model directory")}
                </button>
                {modelCatalog?.source === "offline" && (
                  <div style={{ marginTop: 8, color: "var(--text-dim)", fontSize: scaledChatFont(11) }}>
                    {t("modelsOfflineCache", "Offline: using the cached model directory.")}
                  </div>
                )}
                {(modelCatalog?.warnings ?? []).map((warning) => (
                  <div
                    key={`${warning.provider}:${warning.code}`}
                    role="alert"
                    style={{
                      marginTop: 8,
                      color: "var(--warning)",
                      fontSize: scaledChatFont(11),
                      whiteSpace: "normal",
                    }}
                  >
                    {warning.message}
                  </div>
                ))}
              </div>
            )}
            {modelsByProvider.map((group, gi) => (
              <div key={group.provider}>
                {modelsByProvider.length > 1 && (
                  <div
                    style={{
                      padding: "8px 12px 4px",
                      fontSize: scaledChatFont(10),
                      fontWeight: 600,
                      color: "var(--text-dim)",
                      textTransform: "uppercase",
                      letterSpacing: "0.07em",
                      borderTop: gi > 0 ? "1px solid var(--border)" : "none",
                    }}
                  >
                    {group.provider}
                  </div>
                )}
                {group.options.map((opt) => {
                  const isActive = opt.modelId === model?.modelId && opt.provider === model?.provider;
                  return (
                    <button
                      key={`${opt.provider}:${opt.modelId}`}
                      onClick={() => onModelPick(opt.provider, opt.modelId, isActive)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        width: "100%",
                        padding: "8px 12px",
                        background: isActive ? "var(--bg-selected)" : "none",
                        border: "none",
                        color: isActive ? "var(--text)" : "var(--text-muted)",
                        cursor: "pointer",
                        fontSize: scaledChatFont(12),
                        textAlign: "left",
                        fontWeight: isActive ? 600 : 400,
                        whiteSpace: "nowrap",
                      }}
                      onMouseEnter={(e) => {
                        if (!isActive) e.currentTarget.style.background = "var(--bg-hover)";
                      }}
                      onMouseLeave={(e) => {
                        if (!isActive) e.currentTarget.style.background = "none";
                      }}
                    >
                      {isActive ? <CheckIcon size={10} /> : <span style={{ width: 10, flexShrink: 0 }} />}
                      {opt.name}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
