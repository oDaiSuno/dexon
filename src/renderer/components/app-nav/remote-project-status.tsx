import { useI18n } from "@/i18n";
import { REMOTE_CONNECTION_LOOK, type WorkspaceFacts } from "@/lib/remote-workspace";

export function RemoteServerIcon() {
  const { t } = useI18n();
  return (
    <svg
      width={17}
      height={17}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={t("sshSidebarServerIcon", "Remote server")}
      style={{ display: "block", flexShrink: 0, color: "var(--fx-text-secondary)" }}
    >
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="m7 9 3 3-3 3m6 0h4" />
    </svg>
  );
}

export function RemoteHostCapsule({ workspace }: { workspace: Extract<WorkspaceFacts, { kind: "ssh" }> }) {
  const { t } = useI18n();
  const look = REMOTE_CONNECTION_LOOK[workspace.connection];
  const labels = {
    sshSidebarHostConnected: t("sshSidebarHostConnected", "@{host}"),
    sshSidebarHostOffline: t("sshSidebarHostOffline", "@{host} · offline"),
    sshSidebarHostReconnecting: t("sshSidebarHostReconnecting", "@{host} · reconnecting"),
  };
  const warning = look.tone === "warning";
  const label = labels[look.labelKey].replace("{host}", workspace.hostLabel);
  return (
    <span
      title={label}
      className="type-mono-meta"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        flexShrink: 1,
        minWidth: 0,
        maxWidth: "65%",
        padding: "1px 5px",
        borderRadius: "var(--radius-chip)",
        border: `1px ${look.dashed ? "dashed" : "solid"} ${warning ? "var(--fx-status-warning-border)" : "var(--fx-line-subtle)"}`,
        background: warning ? "var(--fx-status-warning-soft)" : "var(--fx-surface-inset)",
        color: warning ? "var(--fx-status-warning-text)" : "var(--fx-text-secondary)",
      }}
    >
      {look.pulse && (
        <span
          aria-hidden="true"
          className="process-card-pulse"
          style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--fx-status-warning)", flexShrink: 0 }}
        />
      )}
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
    </span>
  );
}
