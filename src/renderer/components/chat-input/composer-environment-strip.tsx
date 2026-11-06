import { useI18n } from "@/i18n";
import { useConnectionLabel } from "@/lib/connection-labels";
import { useSpaceAttribution, type RemoteSpaceAttribution } from "@/lib/space-attribution";

function RemoteStrip({ attribution }: { attribution: RemoteSpaceAttribution }) {
  const { t } = useI18n();
  const label = useConnectionLabel(attribution.presentation);
  return (
    <div
      className="composer-environment-strip"
      role="status"
      aria-label={t("remoteAttributionSendDestination", "Send destination")}
    >
      <span className="type-label-medium">
        {t("remoteAttributionSendTarget", "Current send destination: remote server")}{" "}
        <span className="type-mono-meta">{attribution.label}</span>
      </span>
      {attribution.displayPath && (
        <span className="composer-environment-strip-path type-mono-meta">{attribution.displayPath}</span>
      )}
      <span
        className="composer-environment-strip-status remote-connection type-meta-default"
        data-tone={attribution.presentation.tone}
      >
        <span className="remote-attribution-dot" aria-hidden="true" />
        {label}
        {!attribution.presentation.canSend && <> · {t("remoteAttributionDraftSaved", "Draft saved automatically")}</>}
      </span>
    </div>
  );
}

export function ComposerEnvironmentStrip() {
  const attribution = useSpaceAttribution();
  return attribution.kind === "remote" ? <RemoteStrip attribution={attribution} /> : null;
}
