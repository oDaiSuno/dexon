import { useI18n } from "@/i18n";
import { useConnectionLabel } from "@/lib/connection-labels";
import { useSpaceAttribution, type RemoteSpaceAttribution } from "@/lib/space-attribution";

export function ServerGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="7" rx="2" />
      <rect x="3" y="14" width="18" height="7" rx="2" />
      <path d="M7 6.5h.01M7 17.5h.01M11 6.5h6M11 17.5h6" />
    </svg>
  );
}

function ServerStatus({ attribution }: { attribution: RemoteSpaceAttribution }) {
  const { t } = useI18n();
  const label = useConnectionLabel(attribution.presentation);
  return (
    <span
      className="top-bar-server-status remote-connection"
      role="status"
      aria-label={t("remoteAttributionServerConnection", "Server connection")}
      data-tone={attribution.presentation.tone}
    >
      <span className="remote-attribution-dot" aria-hidden="true" />
      <span className="type-mono-meta">{attribution.label}</span>
      <span className="type-meta-default">· {label}</span>
    </span>
  );
}

export function TopBarServerStatus() {
  const attribution = useSpaceAttribution();
  return attribution.kind === "remote" ? <ServerStatus attribution={attribution} /> : null;
}
