import { useId, useState } from "react";
import type { EnvironmentView } from "@contract/environment";
import type { RemoteDaemonChoice, RemoveOutcome } from "@contract/environment-commands";
import { useI18n } from "@/i18n";
import { Button } from "../../form-controls";
import { ModelDialogShell } from "../../models/model-dialog-shell";
import { ServerActionError, ServerFooter, serverStackStyle } from "./server-ui";
import { useServerActions, useServerRemovalImpact } from "./use-server-actions";
import { serverDaemonControl } from "./server-daemon-control";

export function RemoveServerDialog({
  view,
  onClose,
  onRemoved,
}: {
  view: EnvironmentView;
  onClose: () => void;
  onRemoved?: (outcome: RemoveOutcome) => void;
}) {
  const { t } = useI18n();
  const radioName = useId();
  const [choice, setChoice] = useState<RemoteDaemonChoice>("keep");
  const [removed, setRemoved] = useState<RemoveOutcome | null>(null);
  const { run, pending, error } = useServerActions();
  const impact = useServerRemovalImpact(view.id);
  const daemonControl = serverDaemonControl(view);
  const canStop = daemonControl === "managed" || daemonControl === "unknown";
  const effectiveChoice = canStop ? choice : "keep";
  const remove = async () => {
    const result = await run({ type: "remove", environmentId: view.id, remoteDaemon: effectiveChoice });
    if (result.ok) {
      setRemoved(result.value);
      onRemoved?.(result.value);
    }
  };
  const outcomes = {
    kept: t("serversRemovedKept", "The server was removed from this computer. The remote daemon was left running."),
    stopped: t("serversRemovedStopped", "The server was removed and its managed remote daemon was stopped."),
    "not-owned": t(
      "serversRemovedExternal",
      "The server was removed. Its remote service is externally managed and was not stopped.",
    ),
    unreachable: t(
      "serversRemovedUnreachable",
      "The server was removed, but the remote daemon could not be reached. It may still be running. Check the server directly.",
    ),
  };
  return (
    <ModelDialogShell
      width={624}
      dirty={false}
      title={t("serversRemoveTitle", "Remove remote server?")}
      subtitle={view.label}
      divided
      onClose={() => {
        if (!pending) onClose();
      }}
      footer={
        <ServerFooter>
          <Button disabled={Boolean(pending)} onClick={onClose}>
            {removed ? t("close", "Close") : t("cancel", "Cancel")}
          </Button>
          {!removed && (
            <Button
              variant={effectiveChoice === "stop" ? "danger" : "secondary"}
              disabled={Boolean(pending)}
              busy={pending === "remove"}
              onClick={() => void remove()}
            >
              {effectiveChoice === "stop"
                ? t("serversRemoveStop", "Remove and stop remote service")
                : t("serversRemoveKeep", "Remove from this computer")}
            </Button>
          )}
        </ServerFooter>
      }
    >
      <div style={serverStackStyle}>
        {removed ? (
          <p
            role="status"
            className="type-body-default"
            style={{
              margin: 0,
              color:
                removed.remoteDaemon === "unreachable" ? "var(--fx-status-warning-text)" : "var(--fx-text-secondary)",
            }}
          >
            {outcomes[removed.remoteDaemon]}
          </p>
        ) : (
          <>
            <div
              style={{
                display: "grid",
                gap: "var(--space-2)",
                padding: "var(--space-3)",
                borderRadius: "var(--radius-card)",
                border: "1px solid var(--fx-status-warning-border)",
                background: "var(--fx-status-warning-soft)",
                color: "var(--fx-status-warning-text)",
              }}
            >
              <p className="type-label-medium" style={{ margin: 0 }}>
                {impact.mountedSpaces === null
                  ? t("serversMountedUnknown", "Mounted project spaces are still loading.")
                  : t(
                      "serversRemovalSpaces",
                      "{count} mounted project spaces will also be removed from this computer.",
                    ).replace("{count}", String(impact.mountedSpaces))}
              </p>
              <p className="type-label-default" style={{ margin: 0 }}>
                {impact.runningSessions === null
                  ? t(
                      "serversRunningUnknown",
                      "The number of running remote sessions cannot be confirmed. Tasks may still be running.",
                    )
                  : t("serversRemovalSessions", "{count} sessions are currently running on this server.").replace(
                      "{count}",
                      String(impact.runningSessions),
                    )}
              </p>
              {impact.spaces.length > 0 && (
                <ul
                  className="type-mono-meta"
                  style={{ margin: 0, paddingLeft: "var(--space-4)", overflowWrap: "anywhere" }}
                >
                  {impact.spaces.map((space) => (
                    <li key={space.key}>{space.displayPath}</li>
                  ))}
                </ul>
              )}
            </div>
            <fieldset
              disabled={Boolean(pending)}
              style={{ display: "grid", gap: "var(--space-3)", border: 0, padding: 0, margin: 0 }}
            >
              <legend
                className="type-label-medium"
                style={{ marginBottom: "var(--space-2)", color: "var(--fx-text-secondary)" }}
              >
                {t("serversRemovalChoice", "Remote service after removal")}
              </legend>
              {(["keep", "stop"] as const).map((value) => (
                <label
                  key={value}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "var(--space-2)",
                    padding: "var(--space-3)",
                    borderRadius: "var(--radius-card)",
                    border:
                      effectiveChoice === value
                        ? "1px solid var(--fx-accent-blue)"
                        : "1px solid var(--fx-line-default)",
                    background: effectiveChoice === value ? "var(--fx-accent-blue-soft)" : "var(--fx-surface-card)",
                    cursor: value === "stop" && !canStop ? "not-allowed" : "pointer",
                    opacity: value === "stop" && !canStop ? 0.6 : 1,
                  }}
                >
                  <input
                    type="radio"
                    name={radioName}
                    value={value}
                    checked={effectiveChoice === value}
                    disabled={value === "stop" && !canStop}
                    onChange={() => setChoice(value)}
                    style={{ accentColor: "var(--fx-accent-blue)" }}
                  />
                  <span style={{ display: "grid", gap: "var(--space-1)" }}>
                    <strong className="type-label-medium" style={{ color: "var(--fx-text-primary)" }}>
                      {value === "keep"
                        ? t("serversKeepDaemon", "Keep the remote service running (recommended)")
                        : t("serversStopDaemon", "Stop the remote service too")}
                    </strong>
                    <span className="type-label-default" style={{ color: "var(--fx-text-secondary)" }}>
                      {value === "keep"
                        ? t(
                            "serversKeepDaemonHelp",
                            "Only remove the local connection and mounted spaces. Remote sessions and managed processes keep running.",
                          )
                        : t(
                            "serversStopDaemonHelp",
                            "Stopping a Dexon-managed daemon interrupts its sessions and managed processes. Externally managed services cannot be stopped here.",
                          )}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          </>
        )}
        <ServerActionError error={error} />
      </div>
    </ModelDialogShell>
  );
}
