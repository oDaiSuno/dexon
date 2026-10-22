import { useI18n } from "@/i18n";

export function WatchIndicator({ watching, noShrink = false }: { watching: boolean; noShrink?: boolean }) {
  const { t } = useI18n();
  return (
    <span
      title={watching ? t("liveSyncActive", "Live sync active") : t("notWatching", "Not watching")}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        color: watching ? "var(--fx-status-success)" : "var(--fx-text-tertiary)",
        ...(noShrink ? { flexShrink: 0 } : {}),
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: watching ? "var(--fx-status-success)" : "var(--fx-line-default)",
          display: "inline-block",
          boxShadow: watching ? "0 0 4px var(--fx-status-success)" : "none",
        }}
      />
      {watching ? t("live", "live") : t("static", "static")}
    </span>
  );
}
