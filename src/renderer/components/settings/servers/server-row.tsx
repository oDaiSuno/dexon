import type { EnvironmentView } from "@contract/environment";
import { useI18n } from "@/i18n";
import { presentConnection } from "@/lib/connection-presentation";
import { useConnectionLabel } from "@/lib/connection-labels";
import { Badge, Button } from "../../form-controls";
import { ProvisioningSteps } from "./provisioning-steps";
import { ServerDiagnosisCard } from "./server-diagnosis-card";
import { ServerActionError, ServerIcon, serverRowStyle } from "./server-ui";
import { useServerActions } from "./use-server-actions";
import { serverDaemonControl } from "./server-daemon-control";

export function serverHostSummary(view: EnvironmentView): string {
  const target = view.target;
  if (target.kind === "ssh")
    return `${target.user ? `${target.user}@` : ""}${target.hostname || target.sshAlias}:${target.port ?? 22}`;
  return target.kind === "websocket" ? target.url : view.label;
}

export function ServerRow({
  view,
  now,
  mountedSpaces,
  detachedDaemon,
  divider = true,
  onEdit,
  onRemove,
  onOpenProject,
}: {
  view: EnvironmentView;
  now: number;
  mountedSpaces: number | null;
  detachedDaemon: boolean;
  divider?: boolean;
  onEdit: (field?: "remoteStateDir", suggestedValue?: string) => void;
  onRemove: () => void;
  onOpenProject: () => void;
}) {
  const { t, language } = useI18n();
  const { run, pending, error } = useServerActions();
  const presentation = presentConnection(view, now);
  const label = useConnectionLabel(presentation);
  const phase = presentation.status.kind;
  const active = phase === "connected" || phase === "connecting" || phase === "backoff";
  const runtime = view.runtime;
  const daemonControl = serverDaemonControl(view);
  const tone =
    presentation.tone === "online"
      ? "success"
      : presentation.tone === "blocked"
        ? "danger"
        : presentation.tone === "pending"
          ? phase === "connecting"
            ? "running"
            : "warning"
          : "muted";
  const descriptor = view.descriptor;
  return (
    <article
      aria-label={view.label}
      style={{
        display: "grid",
        gap: "var(--space-3)",
        padding: "var(--space-3-5) var(--space-4-5)",
        borderTop: divider ? "1px solid var(--fx-line-default)" : undefined,
        background:
          phase === "connecting"
            ? "var(--fx-accent-blue-soft)"
            : phase === "backoff"
              ? "var(--fx-status-warning-soft)"
              : undefined,
      }}
    >
      <div style={{ ...serverRowStyle, gap: "var(--space-3-5)" }}>
        <ServerIcon tone={phase === "blocked" ? "danger" : phase === "backoff" ? "warning" : "accent"} />
        <div style={{ flex: 1, minWidth: 180, display: "grid", gap: "var(--space-1)" }}>
          <div style={serverRowStyle}>
            <strong
              className="type-body-large-medium"
              style={{ color: "var(--fx-text-primary)", overflowWrap: "anywhere" }}
            >
              {view.label}
            </strong>
            <Badge tone="neutral">
              {view.target.kind === "ssh" ? t("serversProtocolSsh", "SSH") : t("serversProtocolWebSocket", "WebSocket")}
            </Badge>
            {daemonControl === "external" ? (
              <Badge tone="muted">{t("serversDaemonExternal", "Externally managed service")}</Badge>
            ) : detachedDaemon && daemonControl === "managed" ? (
              <Badge tone="accent">{t("serversIndependentDaemon", "Independent daemon")}</Badge>
            ) : null}
          </div>
          <span className="type-mono-meta" style={{ color: "var(--fx-text-tertiary)", overflowWrap: "anywhere" }}>
            {serverHostSummary(view)}
            {descriptor ? ` · ${descriptor.platform.os} ${descriptor.platform.arch}` : ""}
          </span>
          {mountedSpaces !== null && (
            <span className="type-label-default" style={{ color: "var(--fx-text-tertiary)" }}>
              {t("serversMountedCount", "{count} mounted project spaces").replace("{count}", String(mountedSpaces))}
            </span>
          )}
          {runtime && (
            <span className="type-label-default" style={{ color: "var(--fx-text-tertiary)" }}>
              {t("serversNodeRuntime", "Node.js")} {runtime.nodeVersion} · {runtime.payloadVersion}
              {" · "}
              {t("serversDaemonStarted", "Started")} {new Date(runtime.startedAt).toLocaleString(language)}
            </span>
          )}
        </div>
        <output aria-live="polite">
          <Badge tone={tone}>
            {tone === "muted" && (
              <span
                aria-hidden="true"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "var(--radius-pill)",
                  background: "var(--fx-text-faint)",
                  flexShrink: 0,
                }}
              />
            )}
            {label}
            {presentation.countdown === null ? "" : ` · ${presentation.countdown}s`}
            {presentation.step === null ? "" : ` (${presentation.step}/4)`}
          </Badge>
        </output>
        <div style={{ ...serverRowStyle, gap: "var(--space-1-5)" }}>
          {presentation.canSend && (
            <Button disabled={Boolean(pending)} onClick={onOpenProject}>
              {t("serversOpenProject", "Open project")}
            </Button>
          )}
          {phase !== "blocked" && (
            <Button
              disabled={Boolean(pending)}
              busy={pending === "connect" || pending === "disconnect"}
              onClick={() =>
                void run({
                  type: phase === "backoff" ? "connect" : active ? "disconnect" : "connect",
                  environmentId: view.id,
                })
              }
            >
              {phase === "backoff"
                ? t("serversReconnectNow", "Reconnect now")
                : phase === "connecting"
                  ? t("cancel", "Cancel")
                  : active
                    ? t("serversDisconnect", "Disconnect")
                    : t("serversConnect", "Connect")}
            </Button>
          )}
          {phase === "backoff" && (
            <Button
              disabled={Boolean(pending)}
              onClick={() => void run({ type: "disconnect", environmentId: view.id })}
            >
              {t("serversDisconnect", "Disconnect")}
            </Button>
          )}
          <Button disabled={Boolean(pending)} onClick={() => onEdit()}>
            {t("serversEdit", "Edit")}
          </Button>
          <Button variant="ghost" disabled={Boolean(pending)} onClick={onRemove}>
            {t("serversRemove", "Remove")}
          </Button>
        </div>
      </div>
      {view.status.phase === "backoff" && (
        <p className="type-body-default" style={{ margin: 0, color: "var(--fx-status-warning-text)" }}>
          {t("serversRetryCountdown", "The connection was interrupted. Retrying in {seconds} seconds.").replace(
            "{seconds}",
            String(presentation.countdown ?? 0),
          )}{" "}
          {t("serversRetryAttempt", "Next attempt {attempt}.").replace(
            "{attempt}",
            String(view.status.failureCount + 1),
          )}
        </p>
      )}
      <ProvisioningSteps presentation={presentation} />
      {presentation.diagnosis && (
        <ServerDiagnosisCard
          context="connection"
          key={presentation.diagnosis.reason}
          diagnosis={presentation.diagnosis}
          view={view}
          onEdit={onEdit}
        />
      )}
      {runtime?.updatePending && daemonControl === "managed" && (
        <div style={serverRowStyle}>
          <span className="type-label-default" style={{ color: "var(--fx-status-warning-text)" }}>
            {t("serversUpdatePending", "A remote service update is ready. Restarting interrupts running sessions.")}
          </span>
          <Button
            disabled={Boolean(pending)}
            busy={pending === "restart-daemon"}
            onClick={() => void run({ type: "restart-daemon", environmentId: view.id })}
          >
            {t("serversRestartDaemon", "Restart and update")}
          </Button>
        </div>
      )}
      <ServerActionError error={error} />
    </article>
  );
}
