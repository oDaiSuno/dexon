import { useCallback, useMemo, useState, type CSSProperties, type KeyboardEvent, type RefObject } from "react";
import { useI18n } from "@/i18n";
import type { ModelCatalogStatus } from "@contract/types";
import { ArrowRightIcon, RefreshCwIcon, SearchIcon } from "./icons";
import { CLEAR, HOVER, paint, QUICK } from "./menu-chrome";
import { filterModelGroups, providerDisplayName, type ModelGroup } from "./model-catalog";
import { ModelGroupList, RecentModelGroup } from "./model-picker-list";
import { readRecentModels, rememberRecentModel } from "./recent-models";

const FOOTER_BUTTON: CSSProperties = {
  display: "flex",
  alignItems: "center",
  height: 28,
  border: "none",
  borderRadius: "var(--radius-row)",
  background: CLEAR,
  cursor: "pointer",
  transition: `background ${QUICK}`,
};

export function ModelPickerCard({
  panelRef,
  buttonRef,
  style,
  model,
  groups,
  modelCatalog,
  modelRefreshing,
  onModelsRefresh,
  onManageModels,
  onModelPick,
  onClose,
}: {
  panelRef: RefObject<HTMLDivElement | null>;
  buttonRef: RefObject<HTMLButtonElement | null>;
  style: CSSProperties;
  model?: { provider: string; modelId: string } | null;
  groups: readonly ModelGroup[];
  modelCatalog?: ModelCatalogStatus;
  modelRefreshing?: boolean;
  onModelsRefresh?: () => Promise<void> | void;
  onManageModels?: () => void;
  onModelPick: (provider: string, modelId: string, isActive: boolean) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [recent] = useState(readRecentModels);
  const label = t("modelSearchModels", "Search models…");
  const visible = useMemo(() => filterModelGroups(groups, query), [groups, query]);
  const recentOptions = useMemo(() => {
    const found: { option: ModelGroup["options"][number]; custom: boolean }[] = [];
    for (const entry of recent) {
      for (const group of groups) {
        const option = group.options.find(
          (candidate) => candidate.provider === entry.provider && candidate.modelId === entry.modelId,
        );
        if (!option) continue;
        found.push({ option, custom: group.custom });
        break;
      }
    }
    return found;
  }, [groups, recent]);
  const pick = useCallback(
    (provider: string, modelId: string, isActive: boolean) => {
      rememberRecentModel({ provider, modelId });
      onModelPick(provider, modelId, isActive);
    },
    [onModelPick],
  );
  const warnings = modelCatalog?.warnings;
  const groupProviders = useMemo(() => new Set(groups.map((group) => group.provider)), [groups]);
  const failedProviders = useMemo(
    () => new Set((warnings ?? []).filter((warning) => warning.provider !== "*").map((warning) => warning.provider)),
    [warnings],
  );
  const notices = (warnings ?? []).filter((warning) => !groupProviders.has(warning.provider));
  const offline = modelCatalog?.source === "offline";
  const showEmpty = query.trim().length > 0 && visible.length === 0;

  const pickFirstMatch = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    const option = visible[0]?.options[0];
    if (!option) return;
    pick(option.provider, option.modelId, option.modelId === model?.modelId && option.provider === model?.provider);
  };

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={t("models", "Models")}
      className="chat-appearance-scope composer-pop-in"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
        buttonRef.current?.focus();
      }}
      style={{
        position: "fixed",
        ...style,
        transformOrigin: "bottom center",
        zIndex: 500,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        background: "var(--fx-surface-raised)",
        border: "1px solid var(--fx-line-default)",
        borderRadius: "var(--radius-composer)",
        boxShadow: "var(--shadow-picker)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          height: 44,
          flexShrink: 0,
          boxSizing: "border-box",
          padding: "0 14px",
          borderBottom: "1px solid var(--fx-line-default)",
        }}
      >
        <span style={{ display: "flex", flexShrink: 0, color: "var(--fx-text-tertiary)" }}>
          <SearchIcon size={15} strokeWidth={1.75} />
        </span>
        <input
          type="text"
          role="searchbox"
          autoFocus
          spellCheck={false}
          autoComplete="off"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={pickFirstMatch}
          aria-label={label}
          placeholder={label}
          className="type-body-default placeholder:text-[var(--fx-text-tertiary)]"
          style={{
            flex: 1,
            minWidth: 0,
            height: "100%",
            padding: 0,
            border: "none",
            background: "none",
            color: "var(--fx-text-primary)",
            caretColor: "var(--fx-accent-blue)",
            outline: "none",
          }}
        />
      </div>
      {(offline || notices.length > 0) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2, flexShrink: 0, padding: "8px 14px 0" }}>
          {offline && (
            <div className="type-meta-default" style={{ color: "var(--fx-text-tertiary)" }}>
              {t("modelsOfflineCache", "Offline: using the cached model directory.")}
            </div>
          )}
          {notices.map((warning) => (
            <div
              key={`${warning.provider}:${warning.code}`}
              role="alert"
              className="type-meta-default"
              style={{ color: "var(--fx-status-warning-text)" }}
            >
              {warning.code === "MODEL_REFRESH_TIMEOUT"
                ? t("modelRefreshTimedOut", "Refresh timed out. Cached models remain available.")
                : t("modelProviderRefreshFailed", "{provider}: refresh failed").replace(
                    "{provider}",
                    providerDisplayName(warning.provider),
                  )}
            </div>
          ))}
        </div>
      )}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 1,
          padding: 6,
          flex: "0 1 auto",
          minHeight: 0,
          maxHeight: 380,
          overflowY: "auto",
          scrollbarWidth: "none",
          boxSizing: "border-box",
        }}
      >
        {query.trim().length === 0 && recentOptions.length > 0 && (
          <RecentModelGroup options={recentOptions} model={model} onModelPick={pick} />
        )}
        <ModelGroupList groups={visible} model={model} failedProviders={failedProviders} onModelPick={pick} />
        {showEmpty && (
          <div className="type-body-default" style={{ padding: "12px 10px", color: "var(--fx-text-tertiary)" }}>
            {t("modelNoMatchingModels", "No matching models.")}
          </div>
        )}
      </div>
      {(onModelsRefresh || onManageModels) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            height: 40,
            flexShrink: 0,
            boxSizing: "border-box",
            padding: "0 8px",
            borderTop: "1px solid var(--fx-line-default)",
            background: "var(--fx-surface-raised)",
          }}
        >
          {onModelsRefresh && (
            <button
              type="button"
              disabled={modelRefreshing}
              onClick={() => void onModelsRefresh()}
              className="type-label-default"
              style={{
                ...FOOTER_BUTTON,
                gap: 6,
                padding: "0 8px",
                color: "var(--fx-text-tertiary)",
                cursor: modelRefreshing ? "wait" : "pointer",
                whiteSpace: "nowrap",
              }}
              onMouseEnter={(event) => !modelRefreshing && paint(event, HOVER)}
              onMouseLeave={(event) => paint(event, CLEAR)}
            >
              <RefreshCwIcon size={13} strokeWidth={1.75} />
              {modelRefreshing
                ? t("refreshingModels", "Refreshing directory…")
                : t("refreshModels", "Refresh directory")}
            </button>
          )}
          <div style={{ flex: 1 }} />
          {onManageModels && (
            <button
              type="button"
              onClick={onManageModels}
              className="type-label-default"
              style={{
                ...FOOTER_BUTTON,
                gap: 4,
                padding: "0 8px 0 10px",
                color: "var(--fx-text-secondary)",
                whiteSpace: "nowrap",
              }}
              onMouseEnter={(event) => paint(event, HOVER)}
              onMouseLeave={(event) => paint(event, CLEAR)}
            >
              {t("manageModels", "Manage models")}
              <ArrowRightIcon size={13} strokeWidth={1.75} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
