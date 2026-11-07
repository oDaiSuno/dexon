import { useEffect, useState } from "react";
import type { EnvironmentView } from "@contract/environment";
import { useI18n } from "@/i18n";
import { presentConnection } from "@/lib/connection-presentation";
import { useConnectionLabel } from "@/lib/connection-labels";
import { runEnvironmentCommand } from "@/lib/environment-registry";
import { Button } from "../form-controls";
import { FolderPickerIcon } from "./folder-picker-ui";

const dotColors = {
  online: "var(--fx-status-success)",
  pending: "var(--fx-status-warning)",
  offline: "var(--fx-text-faint)",
  blocked: "var(--fx-status-danger)",
};

function ServerChoice({
  server,
  selected,
  disabled,
  now,
  onSelect,
}: {
  server: EnvironmentView;
  selected: boolean;
  disabled: boolean;
  now: number;
  onSelect: (id: string) => void;
}) {
  const { t } = useI18n();
  const presentation = presentConnection(server, now);
  const label = useConnectionLabel(presentation);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const connecting = server.status.phase === "connecting";
  const connect = async () => {
    if (pending || disabled) return;
    onSelect(server.id);
    setError(false);
    setPending(true);
    try {
      await runEnvironmentCommand({ type: "connect", environmentId: server.id });
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  };
  const endpoint =
    server.target.kind === "ssh"
      ? `${server.target.user ? `${server.target.user}@` : ""}${server.target.hostname || server.target.sshAlias}:${server.target.port ?? 22}`
      : server.target.kind === "websocket"
        ? server.target.url
        : "";
  return (
    <li
      style={{
        display: "grid",
        minWidth: 0,
        gap: "var(--space-1)",
        borderRadius: "var(--radius-card)",
        background: "var(--fx-surface-raised)",
        border: selected ? "1px solid var(--fx-accent-blue)" : "1px solid var(--fx-line-default)",
        padding: "var(--space-2) var(--space-2-5)",
      }}
    >
      <Button
        variant="ghost"
        disabled={disabled}
        aria-label={`${t("remoteFolderSelectServer", "Select server")} ${server.label}`}
        aria-pressed={selected}
        onClick={() => onSelect(server.id)}
        style={{
          width: "100%",
          minWidth: 0,
          height: "auto",
          padding: 0,
          display: "grid",
          gap: "var(--space-1)",
          justifyContent: "stretch",
          textAlign: "left",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: "var(--space-1-5)", minWidth: 0 }}>
          <FolderPickerIcon kind="server" size={14} />
          <span
            className="type-body-medium"
            style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", color: "var(--fx-text-primary)" }}
          >
            {server.label}
          </span>
          <span
            className="type-meta-default"
            style={{
              flexShrink: 0,
              color: presentation.tone === "offline" ? "var(--fx-text-tertiary)" : dotColors[presentation.tone],
            }}
          >
            {label}
            {presentation.countdown !== null ? ` · ${presentation.countdown}s` : ""}
          </span>
          <span
            aria-hidden="true"
            style={{
              width: "var(--space-1-5)",
              height: "var(--space-1-5)",
              flexShrink: 0,
              borderRadius: "var(--radius-pill)",
              background: dotColors[presentation.tone],
            }}
          />
        </span>
        <span
          className="type-mono-meta"
          style={{ overflow: "hidden", textOverflow: "ellipsis", color: "var(--fx-text-secondary)" }}
          title={endpoint}
        >
          {endpoint}
        </span>
        {server.descriptor && server.status.phase === "connected" && (
          <span
            className="type-mono-meta"
            style={{ color: "var(--fx-accent-blue-text)", overflow: "hidden", textOverflow: "ellipsis" }}
          >
            {t("remoteFolderServerHome", "Home")} · {server.descriptor.platform.home}
          </span>
        )}
      </Button>
      {server.status.phase !== "connected" && (
        <Button
          disabled={disabled || pending || connecting}
          busy={pending}
          onClick={() => void connect()}
          style={{
            justifySelf: "start",
            minHeight: "var(--space-6)",
            height: "var(--space-6)",
            padding: "0 var(--space-2)",
            color: "var(--fx-accent-blue-text)",
          }}
        >
          <span className="type-meta-default">
            {server.status.phase === "blocked" || server.status.phase === "backoff"
              ? t("remoteFolderRetryConnection", "Retry connection")
              : t("remoteFolderConnectNow", "Connect now")}
          </span>
        </Button>
      )}
      {error && (
        <span role="alert" className="type-meta-default" style={{ color: "var(--fx-status-danger-text)" }}>
          {t("remoteFolderConnectFailed", "Could not connect. Retry or check this server in Settings.")}
        </span>
      )}
    </li>
  );
}

export interface ServerColumnProps {
  servers: readonly EnvironmentView[];
  targetEnvironmentId: string | null;
  disabled?: boolean;
  onSelectServer: (id: string) => void;
  onOpenSettings: () => void;
}

export function ServerColumn({
  servers,
  targetEnvironmentId,
  disabled = false,
  onSelectServer,
  onOpenSettings,
}: ServerColumnProps) {
  const { t } = useI18n();
  const [now, setNow] = useState(Date.now);
  const countdown = servers.some((server) => server.status.phase === "backoff");
  useEffect(() => {
    if (!countdown) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [countdown]);
  return (
    <aside
      className="remote-folder-server-column"
      aria-label={t("remoteFolderServers", "Remote servers")}
      style={{
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
        padding: "var(--space-3)",
        background: "var(--fx-surface-card)",
      }}
    >
      <h3 className="type-label-medium" style={{ margin: "0 0 var(--space-1)", color: "var(--fx-text-secondary)" }}>
        {t("remoteFolderChooseServer", "Choose a remote server")}
      </h3>
      <ul
        className="remote-folder-server-list"
        style={{
          display: "grid",
          gap: "var(--space-2)",
          listStyle: "none",
          margin: 0,
          padding: 0,
          overflowY: "auto",
        }}
      >
        {servers.map((server) => (
          <ServerChoice
            key={server.id}
            server={server}
            selected={server.id === targetEnvironmentId}
            now={now}
            disabled={disabled}
            onSelect={onSelectServer}
          />
        ))}
      </ul>
      <Button
        disabled={disabled}
        onClick={onOpenSettings}
        style={{
          marginTop: "auto",
          width: "100%",
          height: "auto",
          padding: "var(--space-2-5) var(--space-3)",
          border: "1px dashed var(--fx-accent-blue-border)",
          background: "var(--fx-accent-blue-soft)",
          color: "var(--fx-accent-blue-text)",
          whiteSpace: "normal",
          textAlign: "left",
        }}
      >
        <span className="type-label-medium">{t("remoteFolderAddServer", "+ Connect a new remote server ↗")}</span>
      </Button>
    </aside>
  );
}
