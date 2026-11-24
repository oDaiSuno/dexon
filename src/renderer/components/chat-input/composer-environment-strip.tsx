import { useEffect, useRef, useState } from "react";
import type { PortForwardEntry } from "@contract/environment-commands";
import { useI18n } from "@/i18n";
import { useEnvironmentsSnapshot } from "@/lib/environment-registry";
import { useConnectionLabel } from "@/lib/connection-labels";
import { useSpaceAttribution, type RemoteSpaceAttribution } from "@/lib/space-attribution";

function RemoteStrip({ attribution }: { attribution: RemoteSpaceAttribution }) {
  const { t } = useI18n();
  const label = useConnectionLabel(attribution.presentation);
  const { portForwards = [] } = useEnvironmentsSnapshot();
  const forwards = portForwards.filter(
    (entry) => entry.environmentId === attribution.environmentId && entry.status === "active",
  );
  const [openingPort, setOpeningPort] = useState<number | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const openPreview = async (entry: PortForwardEntry) => {
    setOpeningPort(entry.remotePort);
    setPreviewFailed(false);
    try {
      const tab = await window.piBridge.browserCreateUserTab({ url: entry.localUrl, activate: true });
      if (mounted.current) {
        window.dispatchEvent(new window.CustomEvent("dexon:open-browser-tab", { detail: { tabId: tab.id } }));
      }
    } catch {
      if (mounted.current) setPreviewFailed(true);
    } finally {
      if (mounted.current) setOpeningPort(null);
    }
  };
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
      {forwards.map((entry) => (
        <button
          key={entry.id}
          type="button"
          className="process-summary-button type-mono-meta"
          style={{ padding: "var(--space-0-5) var(--space-2)", borderRadius: "var(--radius-chip)" }}
          title={`${attribution.label} :${entry.remotePort} → 127.0.0.1:${entry.localPort}`}
          disabled={openingPort !== null}
          aria-busy={openingPort === entry.remotePort || undefined}
          onClick={() => void openPreview(entry)}
        >
          {t("remoteForwardActive", ":{port} previewing").replace("{port}", String(entry.remotePort))}
        </button>
      ))}
      {previewFailed && (
        <span className="type-meta-default" style={{ color: "var(--fx-status-danger-text)" }}>
          {t("remoteForwardOpenFailed", "Could not open the forwarded preview. Try again.")}
        </span>
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
  return attribution.kind === "remote" ? (
    <RemoteStrip key={attribution.environmentId} attribution={attribution} />
  ) : null;
}
