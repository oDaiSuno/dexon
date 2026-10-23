import { useI18n } from "@/i18n";

export function WatchIndicator({
  watching,
  noShrink = false,
  showLabel = true,
}: {
  watching: boolean;
  noShrink?: boolean;
  showLabel?: boolean;
}) {
  const { t } = useI18n();
  return (
    <span
      className="file-viewer-live"
      title={watching ? t("liveSyncActive", "Live sync active") : t("notWatching", "Not watching")}
      style={noShrink ? { flexShrink: 0 } : undefined}
    >
      <span className="file-viewer-live-dot" data-watching={watching} aria-hidden="true" />
      <span className={showLabel ? "type-meta-default" : "sr-only"}>
        {watching ? t("live", "live") : t("static", "static")}
      </span>
    </span>
  );
}
