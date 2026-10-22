import { useI18n } from "@/i18n";

const controlStyle = {
  borderRadius: "var(--radius-card)",
  fontSize: 11,
  padding: "4px 12px",
} as const;

export function OlderHistoryZone({
  sentinelRef,
  hasOlder,
  loadingOlder,
  failed,
  onLoad,
}: {
  sentinelRef: (node: HTMLDivElement | null) => void;
  hasOlder: boolean;
  loadingOlder: boolean;
  failed: boolean;
  onLoad: () => void;
}) {
  const { t } = useI18n();
  if (!hasOlder && !loadingOlder && !failed) return null;
  return (
    <div
      ref={sentinelRef}
      role="group"
      aria-label={t("earlierMessages", "Earlier messages")}
      style={{ display: "flex", justifyContent: "center", padding: 8 }}
    >
      {failed ? (
        <div
          role="alert"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 11,
            color: "var(--fx-status-danger)",
          }}
        >
          <span>{t("earlierMessagesLoadFailed", "Earlier messages could not be loaded.")}</span>
          <button
            type="button"
            onClick={onLoad}
            style={{
              ...controlStyle,
              border: "1px solid var(--fx-status-danger-border)",
              background: "var(--fx-surface-raised)",
              color: "var(--fx-status-danger)",
              cursor: "pointer",
            }}
          >
            {t("retry", "Retry")}
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={loadingOlder}
          onClick={onLoad}
          style={{
            ...controlStyle,
            border: "1px solid var(--fx-line-default)",
            background: "var(--fx-surface-raised)",
            color: "var(--fx-text-secondary)",
            cursor: loadingOlder ? "default" : "pointer",
          }}
        >
          {loadingOlder
            ? t("loadingEarlierMessages", "Loading earlier messages…")
            : t("loadEarlierMessages", "Load earlier messages")}
        </button>
      )}
    </div>
  );
}
