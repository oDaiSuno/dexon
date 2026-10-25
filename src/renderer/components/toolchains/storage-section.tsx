import type { PublicToolchainState, ToolchainCacheId } from "@shared/toolchains/types";
import { useI18n } from "@/i18n";
import { Button } from "../form-controls";
import { FolderOpenIcon } from "./icons";
import { SectionHeader } from "./section-parts";
import { CACHE_ORDER, cacheLabel, formatBytes } from "./shared";

const CACHE_FILLS: Record<ToolchainCacheId, string> = {
  npm: "var(--fx-text-primary)",
  uv: "var(--fx-text-secondary)",
  bun: "var(--fx-text-tertiary)",
  downloads: "var(--fx-text-faint)",
};

export function StorageSection({
  state,
  pendingAction,
  disabled,
  onClearAll,
  onOpenManagedFolder,
}: {
  state: PublicToolchainState;
  pendingAction: string | null;
  disabled: boolean;
  onClearAll?: (cacheIds: ToolchainCacheId[]) => void;
  onOpenManagedFolder?: () => void;
}) {
  const { t } = useI18n();
  const caches = CACHE_ORDER.flatMap((cacheId) => {
    const cache = state.caches?.[cacheId];
    return cache ? [cache] : [];
  });
  const total = caches.reduce((sum, cache) => sum + (cache.diskBytes ?? 0), 0);
  const clearable = caches
    .filter((cache) => cache.canClear && (cache.diskBytes ?? 0) > 0)
    .map((cache) => cache.cacheId);
  const clearing = Boolean(pendingAction?.startsWith("cache:"));
  return (
    <section style={{ display: "grid", gap: 10 }}>
      <SectionHeader title={t("toolPrivateStorage", "Storage")} />
      <div
        style={{
          overflow: "hidden",
          border: "1px solid var(--fx-line-default)",
          borderRadius: "var(--radius-dialog)",
          background: "var(--fx-surface-raised)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-4)",
            padding: "var(--space-4) var(--space-5)",
          }}
        >
          <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 3 }}>
            <span className="type-body-large-medium" style={{ color: "var(--fx-text-primary)" }}>
              {t("toolManagedLocation", "Managed tools location")}
            </span>
            <span className="type-body-relaxed" style={{ color: "var(--fx-text-tertiary)", textWrap: "pretty" }}>
              {t(
                "toolManagedLocationHint",
                "Tools installed by Dexon live only here and are never added to the system PATH.",
              )}
            </span>
          </div>
          {state.managedRootLabel && (
            <Button title={state.managedRootLabel} onClick={onOpenManagedFolder}>
              <FolderOpenIcon />
              {t("toolOpenManagedFolder", "Open folder")}
            </Button>
          )}
        </div>
        {caches.length > 0 && (
          <div
            style={{
              display: "grid",
              gap: "var(--space-3)",
              padding: "var(--space-4) var(--space-5) 18px",
              borderTop: "1px solid var(--fx-line-default)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
              <span className="type-body-large-medium" style={{ color: "var(--fx-text-primary)" }}>
                {t("toolCache", "Cache")}
              </span>
              <span className="type-mono-label" style={{ flex: 1, color: "var(--fx-text-tertiary)" }}>
                {formatBytes(total, t)}
              </span>
              <Button
                variant="ghost"
                disabled={disabled || clearable.length === 0}
                busy={clearing}
                onClick={() => onClearAll?.(clearable)}
              >
                {t("toolClearAllCaches", "Clear all")}
              </Button>
            </div>
            {total > 0 && (
              <div
                aria-hidden="true"
                style={{ display: "flex", gap: 2, height: 8, borderRadius: 4, overflow: "hidden" }}
              >
                {caches
                  .filter((cache) => (cache.diskBytes ?? 0) > 0)
                  .map((cache) => (
                    <span
                      key={cache.cacheId}
                      style={{ flex: `${cache.diskBytes} 1 0`, height: 8, background: CACHE_FILLS[cache.cacheId] }}
                    />
                  ))}
              </div>
            )}
            <div
              style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--space-2) var(--space-5)" }}
            >
              {caches.map((cache) => (
                <span key={cache.cacheId} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span
                    aria-hidden="true"
                    style={{ width: 8, height: 8, borderRadius: 2, background: CACHE_FILLS[cache.cacheId] }}
                  />
                  <span className="type-label-default" style={{ color: "var(--fx-text-secondary)" }}>
                    {cacheLabel(cache.cacheId, t)}
                  </span>
                  <span className="type-mono-label" style={{ color: "var(--fx-text-tertiary)" }}>
                    {formatBytes(cache.diskBytes, t)}
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
