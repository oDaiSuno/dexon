import { useI18n } from "@/i18n";
import { requestSettings } from "@/lib/settings-request";
import { useSpaceAttribution, type RemoteSpaceAttribution } from "@/lib/space-attribution";
import { useServerActions } from "../settings/servers/use-server-actions";

function RemoteReconnectBanner({ attribution }: { attribution: RemoteSpaceAttribution }) {
  const { t } = useI18n();
  const { run, pending, error } = useServerActions();
  const { presentation, view } = attribution;
  const diagnosis = presentation.diagnosis;
  const message = diagnosis
    ? t("remoteAttributionBlocked", "Connection to {server} needs attention.").replace("{server}", view.label)
    : view.status.phase === "backoff"
      ? t(
          "remoteAttributionRetry",
          "Connection to {server} was interrupted. Reconnecting in {seconds} seconds (attempt {attempt}).",
        )
          .replace("{server}", view.label)
          .replace("{seconds}", String(presentation.countdown ?? 0))
          .replace("{attempt}", String(view.status.failureCount + 1))
      : view.status.phase === "available"
        ? t("remoteAttributionNotConnected", "Not connected to {server}.").replace("{server}", view.label)
        : presentation.tone === "offline"
          ? t("remoteAttributionDisconnected", "Disconnected from {server}.").replace("{server}", view.label)
          : t("remoteAttributionConnecting", "Connecting to {server}…").replace("{server}", view.label);
  return (
    <div
      className="reconnect-banner type-label-medium"
      role={diagnosis ? "alert" : "status"}
      data-tone={presentation.tone}
    >
      <span className="reconnect-banner-message">
        {message} {diagnosis?.detail}
        {!diagnosis &&
          view.status.phase !== "connecting" &&
          (attribution.detachedDaemon
            ? t(
                "remoteAttributionDisconnectedPolicy",
                "Independent mode is enabled; the remote service status will be confirmed after reconnecting.",
              )
            : attribution.externallyManagedDaemon
              ? t(
                  "remoteAttributionExternalReady",
                  "Independent mode is off; externally managed remote services are not stopped by this desktop",
                )
              : t(
                  "remoteAttributionManagedReady",
                  "Independent mode is off; disconnecting or quitting the desktop app stops the remote service",
                ))}
      </span>
      {presentation.primaryAction === "open-settings" && (
        <button
          type="button"
          className="reconnect-banner-action type-label-medium"
          onClick={() => requestSettings("servers")}
        >
          {t("remoteAttributionViewDiagnosis", "View diagnosis")}
        </button>
      )}
      {view.enabled && (presentation.primaryAction === "reconnect-now" || presentation.primaryAction === "connect") && (
        <button
          type="button"
          className="reconnect-banner-action type-label-medium"
          disabled={Boolean(pending)}
          onClick={() => void run({ type: "connect", environmentId: view.id })}
        >
          {t("serversReconnectNow", "Reconnect now")}
        </button>
      )}
      {error && (
        <span role="alert">
          {t("remoteAttributionReconnectFailed", "Reconnect failed.")} {error}
        </span>
      )}
    </div>
  );
}

export function ReconnectBanner() {
  const attribution = useSpaceAttribution();
  if (attribution.kind === "local" || attribution.presentation.tone === "online") return null;
  return <RemoteReconnectBanner key={attribution.environmentId} attribution={attribution} />;
}
