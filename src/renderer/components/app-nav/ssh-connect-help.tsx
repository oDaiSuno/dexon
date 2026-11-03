import { useState, type Dispatch } from "react";
import type { RemoteBrowseResult } from "@contract/workspace";
import { useI18n } from "@/i18n";
import { copyText } from "@/lib/clipboard";
import { SshConnectButton, SshConnectNote } from "./ssh-connect-parts";
import type { SshConnectEvent } from "./ssh-connect-state";

export function SshConnectHelp({
  result,
  dispatch,
}: {
  result: Exclude<RemoteBrowseResult, { status: "ready" }>;
  dispatch: Dispatch<SshConnectEvent>;
}) {
  const { t } = useI18n();
  return (
    <section
      role={result.status === "error" ? "alert" : undefined}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 12,
        borderRadius: "var(--radius-control)",
        background: "var(--fx-status-warning-soft)",
        border: "1px solid var(--fx-status-warning-border)",
      }}
    >
      {result.status === "host-key-unverified" ? (
        <>
          <h3 className="type-body-medium" style={{ color: "var(--fx-status-warning-text)" }}>
            {t("sshConnectHostUnverified", "First connection to {host}: please confirm it is your server").replace(
              "{host}",
              result.host,
            )}
          </h3>
          <code className="type-mono-code" style={{ color: "var(--fx-text-primary)", overflowWrap: "anywhere" }}>
            <span>{result.keyType}</span> · <span>{result.fingerprint}</span>
          </code>
          <SshConnectNote>
            {t(
              "sshConnectRememberHost",
              "Confirm only after checking this fingerprint. It will be saved in ~/.ssh/known_hosts on this computer.",
            )}
          </SshConnectNote>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <SshConnectButton onClick={() => dispatch({ type: "servers" })}>
              {t("sshConnectCancel", "Cancel")}
            </SshConnectButton>
            <SshConnectButton primary enter onClick={() => dispatch({ type: "accept-host-key" })}>
              {t("sshConnectConfirmFingerprint", "Confirm fingerprint and continue")}
            </SshConnectButton>
          </div>
        </>
      ) : result.status === "error" ? (
        <>
          <SshConnectNote>{result.message}</SshConnectNote>
          <SshConnectButton primary onClick={() => dispatch({ type: "retry" })}>
            {t("sshConnectRetry", "Retry")}
          </SshConnectButton>
        </>
      ) : (
        <>
          <h3 className="type-body-medium" style={{ color: "var(--fx-status-warning-text)" }}>
            {result.status === "auth-required"
              ? t("sshConnectAuthRequired", "This server has not registered this computer's SSH key yet")
              : t("sshConnectPythonMissing", "Python 3 is missing on this server")}
          </h3>
          <SshConnectNote>
            {result.status === "auth-required"
              ? t("sshConnectAuthSetup", "Run this command in your terminal to register your key, then retry here.")
              : t(
                  "sshConnectPythonSetup",
                  "Python 3 is needed to sync files and look after remote processes. You can install it with this command.",
                )}
          </SshConnectNote>
          <SshConnectCommand
            command={result.status === "auth-required" ? result.copyIdCommand : result.installCommand}
          />
          {result.status === "python-missing" && (
            <SshConnectButton
              primary
              enter
              disabled={!result.canAutoInstall}
              onClick={() => dispatch({ type: "install-python" })}
            >
              {t("sshConnectInstallPython", "Install on the server and continue")}
            </SshConnectButton>
          )}
          <SshConnectButton
            primary={result.status === "auth-required"}
            enter
            onClick={() => dispatch({ type: "retry" })}
          >
            {t("sshConnectRetryAfterSetup", "Retry after setup")}
          </SshConnectButton>
        </>
      )}
    </section>
  );
}

function SshConnectCommand({ command }: { command: string }) {
  const { t } = useI18n();
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <>
      <pre
        className="type-mono-code"
        style={{
          padding: 10,
          borderRadius: "var(--radius-control)",
          background: "var(--fx-surface-inset)",
          color: "var(--fx-text-primary)",
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      >
        {command}
      </pre>
      <SshConnectButton
        onClick={() =>
          void copyText(command).then(
            () => setCopyStatus("copied"),
            () => setCopyStatus("failed"),
          )
        }
      >
        {copyStatus === "copied" ? t("sshConnectCopied", "Copied") : t("sshConnectCopyCommand", "Copy command")}
      </SshConnectButton>
      {copyStatus === "failed" && (
        <p role="alert" className="type-meta-default" style={{ color: "var(--fx-status-danger-text)" }}>
          {t("sshConnectCopyFailed", "Could not copy. Check clipboard permission and try again.")}
        </p>
      )}
    </>
  );
}
