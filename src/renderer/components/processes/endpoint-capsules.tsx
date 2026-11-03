import type { ManagedEndpointView, ManagedProcessPublicInfo } from "@contract/processes";
import { useI18n } from "@/i18n";
import { endpointPort } from "./process-format";

export function EndpointCapsules({
  process,
  onOpen,
}: {
  process: ManagedProcessPublicInfo;
  onOpen: (url: string) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: "var(--space-2)",
        paddingLeft: 22,
      }}
    >
      {process.endpointViews?.map((view) => (
        <EndpointCapsule key={view.id} view={view} watchdogLeaseMs={process.watchdogLeaseMs} onOpen={onOpen} />
      ))}
    </div>
  );
}

function EndpointCapsule({
  view,
  watchdogLeaseMs,
  onOpen,
}: {
  view: ManagedEndpointView;
  watchdogLeaseMs?: number;
  onOpen: (url: string) => void;
}) {
  const { t } = useI18n();
  const available = view.state === "available" && Boolean(view.openUrl);
  const mapping = view.state === "mapping";
  const localPort = view.localPort ?? endpointPort(view.openUrl ?? "") ?? "—";
  const color = available
    ? "var(--fx-status-success-text)"
    : mapping
      ? "var(--fx-accent-blue-text)"
      : "var(--fx-status-warning-text)";
  const label = available
    ? t("sshProcessAvailable", "Remote :{remotePort} ⇄ local 127.0.0.1:{localPort} · Preview ↗")
        .replace("{remotePort}", String(view.remotePort))
        .replace("{localPort}", String(localPort))
    : mapping
      ? t("sshProcessMapping", "◌ Remote :{remotePort} → opening local tunnel…").replace(
          "{remotePort}",
          String(view.remotePort),
        )
      : t("sshProcessUnavailable", "! :{remotePort} tunnel unavailable").replace(
          "{remotePort}",
          String(view.remotePort),
        );
  const surface = available
    ? "var(--fx-status-success-soft)"
    : mapping
      ? "var(--fx-accent-blue-soft)"
      : "var(--fx-status-warning-soft)";
  const content = (
    <span className="type-mono-meta" style={{ color }}>
      {label}
    </span>
  );
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: "var(--space-1)",
        minWidth: 0,
        maxWidth: "100%",
      }}
    >
      {available ? (
        <button
          type="button"
          className="process-card-port"
          aria-label={label}
          style={{
            border: "none",
            borderRadius: "var(--radius-chip)",
            padding: "var(--space-1) var(--space-2)",
            background: surface,
            textAlign: "left",
            cursor: "pointer",
          }}
          onClick={() => onOpen(view.openUrl!)}
        >
          {content}
        </button>
      ) : (
        <span
          style={{ borderRadius: "var(--radius-chip)", padding: "var(--space-1) var(--space-2)", background: surface }}
        >
          {mapping && (
            <span
              className="process-card-pulse"
              aria-hidden="true"
              style={{
                display: "inline-block",
                width: 6,
                height: 6,
                marginRight: "var(--space-1)",
                borderRadius: "50%",
                background: "var(--fx-accent-blue)",
              }}
            />
          )}
          {content}
        </span>
      )}
      <span className="type-meta-default" style={{ color: "var(--fx-text-tertiary)", overflowWrap: "anywhere" }}>
        {mapping
          ? t("sshProcessHandshake", "SSH tunnel handshake in progress; preview will be available once connected")
          : available && view.portShifted
            ? t("sshProcessPortShifted", "Local port {remotePort} was in use; shifted to 127.0.0.1:{localPort}")
                .replace("{remotePort}", String(view.remotePort))
                .replace("{localPort}", String(localPort))
            : !available
              ? (view.reason ?? t("sshProcessNoLocalAddress", "The local tunnel address is not available"))
              : null}
      </span>
      {available && watchdogLeaseMs !== undefined && (
        <span className="type-meta-default" style={{ color: "var(--fx-text-tertiary)" }}>
          {t("sshProcessWatchdog", "{seconds}s watchdog attached").replace("{seconds}", String(watchdogLeaseMs / 1000))}
        </span>
      )}
    </div>
  );
}
