import { useI18n } from "@/i18n";
import { useRemoteWorkspacesContext, useWorkspaceFacts } from "../app-shell/remote-workspaces-context";

export function RemoteBoundWorkspaceStatus({ folder }: { folder: string }) {
  const { t } = useI18n();
  const facts = useWorkspaceFacts(folder);
  const remote = useRemoteWorkspacesContext();
  if (facts.kind !== "ssh") return null;
  const connected = facts.connection === "connected";
  const label = connected
    ? t("sshCardOnline", "{rtt}ms online").replace("{rtt}", String(facts.rttMs ?? "?"))
    : facts.connection === "reconnecting"
      ? t("sshCardReconnecting", "reconnecting")
      : t("sshCardOffline", "offline");
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "8px 0",
        color: connected ? "var(--fx-status-success-text)" : "var(--fx-text-tertiary)",
      }}
    >
      <span aria-hidden="true">●</span>
      <span className="type-meta-default">{label}</span>
      {!connected && remote && (
        <button
          type="button"
          className="type-label-medium"
          onClick={() => void remote.reconnect(facts.key).catch(remote.reportError)}
          style={{
            border: "none",
            background: "var(--fx-surface-hover-clear)",
            color: "var(--fx-accent-blue-text)",
            cursor: "pointer",
            marginLeft: "auto",
          }}
        >
          {t("sshCardReconnect", "Reconnect now")}
        </button>
      )}
    </div>
  );
}
