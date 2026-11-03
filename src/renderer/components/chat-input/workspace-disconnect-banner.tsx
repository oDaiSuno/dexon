import { useState } from "react";
import { useI18n } from "@/i18n";
import { useRemoteWorkspacesContext, useWorkspaceFacts } from "../app-shell/remote-workspaces-context";
import { ComposerBanner } from "./StatusBanners";

export function WorkspaceDisconnectBanner({ cwd }: { cwd?: string }) {
  const { t } = useI18n();
  const remote = useRemoteWorkspacesContext();
  const facts = useWorkspaceFacts(cwd);
  const snapshot = facts.kind === "ssh" ? facts.state : null;
  const containment = snapshot?.containment;
  const identity = JSON.stringify([
    facts.key,
    facts.kind === "ssh" ? facts.connection : "local",
    containment?.state,
    containment?.activeRemoteProcessCount,
    containment?.leakedPgid,
    snapshot?.reconnectAttempt,
    snapshot?.maxReconnectAttempts,
  ]);
  const [dismissal, setDismissal] = useState({ identity, dismissed: false });
  if (dismissal.identity !== identity) setDismissal({ identity, dismissed: false });
  if (!remote || facts.kind !== "ssh" || (dismissal.identity === identity && dismissal.dismissed)) return null;
  const leaked = containment?.state === "verified-leak";
  if (!leaked && facts.connection === "connected" && containment?.state !== "pending") return null;
  const messages = leaked
    ? [
        containment.leakedPgid !== undefined
          ? t(
              "sshDisconnectLeaked",
              "Process group #{pgid} did not stop; only new services in this remote workspace are paused",
            ).replace("{pgid}", String(containment.leakedPgid))
          : t(
              "sshDisconnectLeakUnknown",
              "Some remote processes did not stop; only new services in this remote workspace are paused",
            ),
      ]
    : [t("sshDisconnectLost", "Connection lost to {host}").replace("{host}", facts.hostLabel)];
  if (!leaked) {
    if (snapshot?.reconnectAttempt !== undefined && snapshot.maxReconnectAttempts !== undefined)
      messages.push(
        t("sshDisconnectRetrying", "retrying {attempt}/{max}")
          .replace("{attempt}", String(snapshot.reconnectAttempt))
          .replace("{max}", String(snapshot.maxReconnectAttempts)),
      );
    if (containment && containment.activeRemoteProcessCount > 0)
      messages.push(
        t("sshDisconnectReclaiming", "{count} remote processes are being reclaimed by the 15s watchdog").replace(
          "{count}",
          String(containment.activeRemoteProcessCount),
        ),
      );
    messages.push(t("sshDisconnectSaved", "Your history and draft are saved on this computer"));
  }
  return (
    <ComposerBanner
      testId="ssh-workspace-disconnect"
      tone={leaked ? "error" : "warning"}
      message={messages.join(" · ")}
      dismissLabel={t("sshDisconnectDismiss", "Dismiss remote connection notice")}
      onDismiss={() => setDismissal({ identity, dismissed: true })}
      action={
        leaked
          ? {
              label: t("sshDisconnectCleanup", "Clean up again"),
              onClick: () => void remote.cleanupRetry(facts.key).catch(remote.reportError),
            }
          : {
              label: t("sshDisconnectReconnect", "Reconnect now"),
              onClick: () => void remote.reconnect(facts.key).catch(remote.reportError),
            }
      }
    />
  );
}
