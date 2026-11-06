import { useI18n } from "@/i18n";
import { useSpaceAttribution } from "@/lib/space-attribution";

export function RemoteDaemonCapsule() {
  const { t } = useI18n();
  const attribution = useSpaceAttribution();
  if (attribution.kind === "local" || !attribution.presentation.canSend) return null;
  const [beforeServer, afterServer] = t("remoteAttributionConnected", "Remote environment {server} connected").split(
    "{server}",
  );
  return (
    <div className="remote-daemon-capsule type-label-medium" role="status">
      <span className="remote-attribution-dot" aria-hidden="true" />
      <span>
        {beforeServer}
        <span className="type-mono-meta">{attribution.label}</span>
        {afterServer}
        {" · "}
        {attribution.detachedDaemon
          ? t(
              "remoteAttributionDetachedReady",
              "The remote daemon runs independently; closing your laptop or disconnecting does not interrupt tasks",
            )
          : attribution.externallyManagedDaemon
            ? t(
                "remoteAttributionExternalReady",
                "Independent mode is off; externally managed remote services are not stopped by this desktop",
              )
            : t(
                "remoteAttributionManagedReady",
                "Independent mode is off; disconnecting or quitting the desktop app stops the remote service",
              )}
      </span>
    </div>
  );
}
