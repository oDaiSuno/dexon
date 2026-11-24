import type { CSSProperties, RefObject } from "react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/i18n";
import { useEnvironmentsSnapshot } from "@/lib/environment-registry";
import { requestResources, requestSettings } from "@/lib/settings-request";
import type { RemoteSpaceAttribution } from "@/lib/space-attribution";
import { workspaceStore } from "@/lib/workspace-store";
import { Badge, Button } from "../form-controls";
import { serverHostSummary } from "../settings/servers/server-row";
import { useServerActions } from "../settings/servers/use-server-actions";
import { serverDaemonControl } from "../settings/servers/server-daemon-control";

export interface RemoteControlPopoverProps {
  id: string;
  attribution: RemoteSpaceAttribution;
  statusLabel: string;
  popoverRef: RefObject<HTMLDivElement | null>;
  position: CSSProperties;
  onClose: () => void;
  onOpenFolder: () => void;
}

export function RemoteControlPopover({
  id,
  attribution,
  statusLabel,
  popoverRef,
  position,
  onClose,
  onOpenFolder,
}: RemoteControlPopoverProps) {
  const { t } = useI18n();
  const { run, pending, error } = useServerActions();
  const [externalFailed, setExternalFailed] = useState(false);
  const [restartGeneration, setRestartGeneration] = useState<number | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const { environmentId, presentation, view } = attribution;
  const managed = serverDaemonControl(view) === "managed";
  const updatePending = managed && view.runtime?.updatePending;
  const stopsOnDisconnect =
    !attribution.externallyManagedDaemon &&
    view.target.kind === "ssh" &&
    (view.target.stopOnDisconnect ?? !attribution.detachedDaemon);
  const disconnectHint = stopsOnDisconnect
    ? t("schemeCRemoteDisconnectStops", "Disconnecting stops the remote service and interrupts its tasks.")
    : t("schemeCRemoteDisconnectKeeps", "Disconnecting does not stop remote tasks.");
  const snapshot = useEnvironmentsSnapshot();
  const workspace = useSyncExternalStore(
    workspaceStore.subscribe,
    workspaceStore.getSnapshot,
    workspaceStore.getSnapshot,
  );
  const mountedSpaces = workspace.spaces.filter((space) => space.environmentId === environmentId).length;
  const forwards = (snapshot.portForwards ?? []).filter(
    (entry) => entry.environmentId === environmentId && entry.status === "active",
  );
  const phase = presentation.status.kind;
  const connected = phase === "connected";
  const confirmRestart = managed && view.status.phase === "connected" && restartGeneration === view.status.generation;
  const showRestartConfirmation = () => {
    if (view.status.phase === "connected") setRestartGeneration(view.status.generation);
  };
  const top = typeof position.top === "number" ? `${position.top}px` : position.top;
  const navigate = (action: () => void) => {
    onClose();
    action();
  };

  useEffect(() => {
    (confirmRestart ? cancelRef.current : popoverRef.current)?.focus({ preventScroll: true });
  }, [confirmRestart, popoverRef]);

  return createPortal(
    <div
      id={id}
      ref={popoverRef}
      role="dialog"
      tabIndex={-1}
      aria-labelledby={`${id}-title`}
      className="remote-control-popover"
      style={{ ...position, maxHeight: `calc(100dvh - ${top ?? "0px"} - var(--space-2))` }}
    >
      <header className="remote-control-header">
        <strong id={`${id}-title`} className="type-body-large-medium">
          {attribution.label}
        </strong>
        <span className="remote-control-secondary type-mono-meta">{serverHostSummary(attribution.view)}</span>
        <Badge
          tone={
            connected
              ? "success"
              : presentation.tone === "blocked"
                ? "danger"
                : presentation.tone === "offline"
                  ? "muted"
                  : "warning"
          }
        >
          {statusLabel}
        </Badge>
      </header>
      {confirmRestart ? (
        <section className="remote-control-confirm" aria-labelledby={`${id}-restart-title`}>
          <h3 id={`${id}-restart-title`} className="type-body-medium">
            {t("schemeCConfirmRestart", "Confirm daemon restart")}
          </h3>
          <p className="type-body-default">
            {t("schemeCRestartWarning", "Running sessions and processes on this server will be interrupted.")}
          </p>
          <div className="remote-control-actions">
            <button
              type="button"
              className="ui-button type-body-medium"
              ref={cancelRef}
              disabled={Boolean(pending)}
              onClick={() => setRestartGeneration(null)}
            >
              {t("schemeCRemoteCancel", "Cancel")}
            </button>
            <Button
              variant="danger"
              disabled={Boolean(pending)}
              busy={pending === "restart-daemon"}
              onClick={async () => {
                const result = await run({ type: "restart-daemon", environmentId });
                if (result.ok) setRestartGeneration(null);
              }}
            >
              {t("schemeCConfirmRestart", "Confirm daemon restart")}
            </Button>
          </div>
        </section>
      ) : (
        connected && (
          <>
            <div className="remote-control-metrics remote-control-secondary type-label-default">
              <span>
                {t("schemeCRemoteMountedSpaces", "{count} mounted spaces").replace(
                  "{count}",
                  workspace.loaded ? String(mountedSpaces) : "—",
                )}
              </span>
              <span>
                {t("schemeCRemoteActiveForwards", "{count} active port forwards").replace(
                  "{count}",
                  String(forwards.length),
                )}
              </span>
            </div>
            {updatePending && (
              <div className="remote-control-notice remote-control-warning">
                <p className="type-label-default">
                  {t(
                    "schemeCRemoteUpdatePending",
                    "An update is ready. It will install automatically when the server is idle.",
                  )}
                </p>
                <Button disabled={Boolean(pending)} onClick={showRestartConfirmation}>
                  {t("schemeCRestartDaemon", "Restart remote daemon")}
                </Button>
              </div>
            )}
            <div className="remote-control-links">
              <Button variant="ghost" className="remote-control-open-folder" onClick={onOpenFolder}>
                {t("schemeCOpenFolder", "Open folder")}
              </Button>
              <Button variant="ghost" onClick={() => navigate(() => requestSettings("models", { environmentId }))}>
                {t("schemeCConfigureServerModels", "Configure models on this server")}
              </Button>
              <Button variant="ghost" onClick={() => navigate(() => requestResources({ environmentId }))}>
                {t("schemeCManageServerResources", "Manage plugins and skills on this server")}
              </Button>
            </div>
            {forwards.length > 0 && (
              <section className="remote-control-ports" aria-label={t("schemeCRemotePorts", "Port forwards")}>
                <h3 className="type-label-medium">{t("schemeCRemotePorts", "Port forwards")}</h3>
                <ul>
                  {forwards.map((entry) => (
                    <li key={entry.id}>
                      <button
                        type="button"
                        className="remote-control-port-link type-mono-meta"
                        aria-label={t("schemeCRemoteOpenPort", "Open port {port} in browser").replace(
                          "{port}",
                          String(entry.remotePort),
                        )}
                        onClick={() => {
                          setExternalFailed(false);
                          void window.piBridge.openExternal(entry.localUrl).catch(() => setExternalFailed(true));
                        }}
                      >
                        {entry.remotePort} → {entry.localUrl}
                      </button>
                      <Button
                        variant="ghost"
                        disabled={Boolean(pending)}
                        aria-label={t("schemeCRemoteClosePort", "Close port forward {port}").replace(
                          "{port}",
                          String(entry.remotePort),
                        )}
                        onClick={() =>
                          void run({ type: "close-port-forward", environmentId, remotePort: entry.remotePort })
                        }
                      >
                        {t("schemeCRemoteClose", "Close")}
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <div className="remote-control-lifecycle">
              {managed && !updatePending && (
                <Button variant="ghost" disabled={Boolean(pending)} onClick={showRestartConfirmation}>
                  {t("schemeCRestartDaemon", "Restart remote daemon")}
                </Button>
              )}
              <Button
                variant="ghost"
                disabled={Boolean(pending)}
                busy={pending === "disconnect"}
                onClick={() => void run({ type: "disconnect", environmentId })}
              >
                {t("schemeCRemoteDisconnect", "Disconnect")}
              </Button>
              <p className="remote-control-secondary type-label-default">{disconnectHint}</p>
            </div>
          </>
        )
      )}
      {!connected && phase !== "blocked" && !confirmRestart && (
        <section className="remote-control-recovery">
          <p className="type-body-default">
            {stopsOnDisconnect
              ? t(
                  "schemeCRemoteRecoveryStops",
                  "The remote service is configured to stop on disconnect. Reconnect to check task status.",
                )
              : t(
                  "schemeCRemoteRecoveryKeeps",
                  "Remote tasks are not stopped by this disconnection. Their status will be checked after reconnecting.",
                )}
          </p>
          <p className="remote-control-secondary type-label-default">
            {t("schemeCRemoteDraftSaved", "Draft saved automatically")}
          </p>
          <div className="remote-control-actions">
            <Button
              disabled={Boolean(pending)}
              busy={pending === "connect"}
              onClick={() => void run({ type: "connect", environmentId })}
            >
              {t("schemeCRemoteReconnectNow", "Reconnect now")}
            </Button>
            {(phase === "backoff" || phase === "connecting") && (
              <Button
                variant="ghost"
                disabled={Boolean(pending)}
                busy={pending === "disconnect"}
                onClick={() => void run({ type: "disconnect", environmentId })}
              >
                {phase === "backoff"
                  ? t("schemeCRemotePause", "Pause reconnecting")
                  : t("schemeCRemoteDisconnect", "Disconnect")}
              </Button>
            )}
          </div>
        </section>
      )}
      {presentation.diagnosis && (
        <section className="remote-control-notice remote-control-error">
          <p className="type-body-medium">
            {
              {
                authentication: t("serversDiagnosisAuthentication", "Passwordless login is not configured"),
                "missing-node": t("serversDiagnosisNode", "Remote Node.js is missing or unsupported"),
                "unsupported-node-version": t("serversDiagnosisNode", "Remote Node.js is missing or unsupported"),
                "host-key-changed": t("serversDiagnosisHostKey", "The remote SSH host identity has changed"),
                "identity-mismatch": t("serversDiagnosisIdentity", "The remote Dexon environment identity has changed"),
                permission: t("serversDiagnosisPermission", "The remote data directory is not writable"),
                "ssh-unavailable": t("serversDiagnosisSsh", "SSH is not available on this computer"),
                "outdated-daemon": t("serversDiagnosisDaemon", "The remote service needs an update"),
                configuration: t("serversDiagnosisConfiguration", "Check the server configuration"),
                unsupported: t("serversDiagnosisUnsupported", "This remote platform is not supported"),
                "unsupported-protocol": t("serversDiagnosisProtocol", "The remote service protocol is not supported"),
              }[presentation.diagnosis.reason]
            }
          </p>
          <div className="remote-control-actions">
            <Button onClick={() => navigate(() => requestSettings("servers", { environmentId }))}>
              {t("schemeCRemoteViewDiagnosis", "View diagnosis")}
            </Button>
            <Button
              variant="ghost"
              disabled={Boolean(pending)}
              busy={pending === "connect"}
              onClick={() => void run({ type: "connect", environmentId })}
            >
              {t("schemeCRemoteRetry", "Retry")}
            </Button>
          </div>
        </section>
      )}
      {(error || externalFailed) && (
        <p role="alert" className="remote-control-error type-label-default">
          {t("schemeCRemoteActionFailed", "The action could not be completed. Try again or open server settings.")}
        </p>
      )}
      {!confirmRestart && (
        <footer className="remote-control-footer">
          <Button variant="ghost" onClick={() => navigate(() => requestSettings("servers", { environmentId }))}>
            {t("schemeCRemoteAllSettings", "All server settings")}
          </Button>
        </footer>
      )}
    </div>,
    document.body,
  );
}
