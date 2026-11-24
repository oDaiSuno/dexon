import { useState } from "react";
import type { EnvironmentView } from "@contract/environment";
import { useI18n } from "@/i18n";
import { presentConnection } from "@/lib/connection-presentation";
import { useConnectionLabel } from "@/lib/connection-labels";
import { requestResources, requestSettings } from "@/lib/settings-request";
import { ActionMenu } from "../../action-menu";
import { ServerRestartConfirmation, ServerRuntimeDetails } from "./server-runtime-tools";
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
  divider = true,
  onEdit,
  onRemove,
  onOpenProject,
}: {
  view: EnvironmentView;
  now: number;
  mountedSpaces: number | null;
  divider?: boolean;
  onEdit: (field?: "remoteStateDir", suggestedValue?: string) => void;
  onRemove: () => void;
  onOpenProject: () => void;
}) {
  const { t } = useI18n();
  const { run, pending, error } = useServerActions();
  const [runtimeDetailsRequest, setRuntimeDetailsRequest] = useState(0);
  const [confirmRestart, setConfirmRestart] = useState(false);
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
  const moreLabel = t("schemeCServersMoreActions", "More actions for {server}").replace("{server}", view.label);
  const restart = async () => {
    if (serverDaemonControl(view) !== "managed") return;
    const result = await run({ type: "restart-daemon", environmentId: view.id });
    if (result.ok) setConfirmRestart(false);
  };
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
            {daemonControl === "external" && (
              <Badge tone="muted">{t("serversDaemonExternal", "Externally managed service")}</Badge>
            )}
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
              {t("schemeCOpenFolder", "Open folder")}
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
          <ActionMenu
            label={moreLabel}
            zIndex={1200}
            trigger={(props) => (
              <Button {...props} variant="ghost" disabled={Boolean(pending)} aria-label={moreLabel}>
                {t("schemeCServersMore", "More")}
              </Button>
            )}
            items={[
              {
                key: "models",
                label: t("schemeCConfigureServerModels", "Configure models on this server"),
                onSelect: () => requestSettings("models", { environmentId: view.id }),
              },
              {
                key: "resources",
                label: t("schemeCManageServerResources", "Manage plugins and skills on this server"),
                onSelect: () => requestResources({ environmentId: view.id }),
              },
              { key: "edit", label: t("schemeCServersEditConnection", "Edit connection"), onSelect: () => onEdit() },
              ...(daemonControl === "managed"
                ? [
                    {
                      key: "restart",
                      label: t("schemeCRestartDaemon", "Restart remote daemon"),
                      onSelect: () => setConfirmRestart(true),
                    },
                  ]
                : []),
              {
                key: "runtime",
                label: t("schemeCServersRuntimeDetails", "Runtime details"),
                onSelect: () => setRuntimeDetailsRequest((request) => request + 1),
              },
              {
                key: "remove",
                label: t("schemeCServersRemove", "Remove remote server"),
                danger: true,
                onSelect: onRemove,
              },
            ]}
          />
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
        <p className="type-label-default" style={{ margin: 0, color: "var(--fx-text-tertiary)" }}>
          {t("schemeCServersUpdatePending", "An update is ready and will be applied when the remote service is idle.")}
        </p>
      )}
      {confirmRestart && daemonControl === "managed" && (
        <ServerRestartConfirmation
          pending={Boolean(pending)}
          onCancel={() => setConfirmRestart(false)}
          onConfirm={() => void restart()}
        />
      )}
      {runtimeDetailsRequest > 0 && <ServerRuntimeDetails key={runtimeDetailsRequest} view={view} initiallyOpen />}
      <ServerActionError error={error} />
    </article>
  );
}
