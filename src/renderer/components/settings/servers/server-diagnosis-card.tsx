import { useEffect, useRef, useState } from "react";
import type { EnvironmentView } from "@contract/environment";
import type { BlockedDiagnosis } from "@contract/environment-status";
import { useI18n } from "@/i18n";
import { describeBlocked } from "@/lib/blocked-diagnosis-view";
import { Button } from "../../form-controls";
import { ServerActionError, serverRowStyle } from "./server-ui";
import { useServerActions } from "./use-server-actions";

export function ServerDiagnosisCard({
  diagnosis,
  view,
  context,
  onEdit,
}: {
  diagnosis: BlockedDiagnosis;
  context: "connection" | "probe";
  view: EnvironmentView;
  onEdit: (field: "remoteStateDir", suggestedValue: string) => void;
}) {
  const { t } = useI18n();
  const model = describeBlocked(diagnosis, view);
  const { run, pending, error } = useServerActions();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      if (active.current) setCopyState("copied");
    } catch {
      if (active.current) setCopyState("failed");
    }
  };
  const titles: Record<BlockedDiagnosis["reason"], string> = {
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
  };
  const fieldLabels = {
    "detected-version": t("serversDetectedVersion", "Detected version"),
    "required-version": t("serversRequiredVersion", "Required version"),
    "known-host": t("serversKnownHost", "SSH host"),
    fingerprint: t("serversFingerprint", "Fingerprint"),
    "known-hosts-file": t("serversKnownHostsFile", "SSH known hosts file"),
    "expected-id": t("serversExpectedId", "Expected environment identity"),
    "actual-id": t("serversActualId", "Received environment identity"),
    path: t("serversDiagnosisPath", "Remote path"),
    protocol: t("serversDiagnosisProtocolVersion", "Remote protocol version"),
  };
  const action = model.action;
  return (
    <section
      role="alert"
      style={{
        display: "grid",
        gap: "var(--space-2)",
        padding: "var(--space-3)",
        border: "1px solid var(--fx-status-danger-border)",
        borderRadius: "var(--radius-control)",
        background: "var(--fx-status-danger-soft)",
        color: "var(--fx-status-danger-text)",
      }}
    >
      <strong className="type-body-medium">{titles[model.reason]}</strong>
      <p className="type-body-default" style={{ margin: 0, overflowWrap: "anywhere" }}>
        {model.detail}
      </p>
      <span className="type-mono-meta" style={{ overflowWrap: "anywhere" }}>
        {model.targetLabel}
      </span>
      {model.fields.length > 0 && (
        <dl
          className="type-label-default"
          style={{
            display: "grid",
            gridTemplateColumns: "auto minmax(0, 1fr)",
            gap: "var(--space-1) var(--space-3)",
            margin: 0,
          }}
        >
          {model.fields.map((field) => (
            <div key={field.kind} style={{ display: "contents" }}>
              <dt>{fieldLabels[field.kind]}</dt>
              <dd className="type-mono-meta" style={{ margin: 0, overflowWrap: "anywhere", userSelect: "text" }}>
                {field.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {action?.kind === "copy" && (
        <pre
          className="type-mono-meta"
          style={{
            margin: 0,
            padding: "var(--space-2)",
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
            background: "var(--fx-surface-raised)",
            borderRadius: "var(--radius-chip)",
            userSelect: "text",
          }}
        >
          <code>{action.text}</code>
        </pre>
      )}
      {action?.kind === "trust" && (
        <p className="type-label-default" style={{ margin: 0 }}>
          {t("serversVerifyTrust", "Verify the identity with your server administrator before trusting it again.")}
          {context === "probe" && (
            <> {t("serversProbeTrustHint", "Save and reconnect before changing trust for this server.")}</>
          )}
        </p>
      )}
      <div style={serverRowStyle}>
        {action?.kind === "copy" && (
          <Button disabled={Boolean(pending)} onClick={() => void copy(action.text)}>
            {copyState === "copied"
              ? t("serversCopied", "Copied")
              : action.purpose === "authentication"
                ? t("serversCopyAuthentication", "Copy setup command")
                : t("serversCopyUpgrade", "Copy upgrade command")}
          </Button>
        )}
        {action?.kind === "trust" && context === "connection" && (
          <Button
            variant="primary"
            disabled={Boolean(pending)}
            busy={pending === "trust"}
            onClick={() => void run({ type: "trust", environmentId: view.id, trust: action.trust })}
          >
            {t("serversTrustAgain", "Verify and trust again")}
          </Button>
        )}
        {action?.kind === "edit-field" && (
          <Button
            variant="primary"
            disabled={Boolean(pending)}
            onClick={() => onEdit(action.field, action.suggestedValue)}
          >
            {t("serversChangeDirectory", "Change remote directory")}
          </Button>
        )}
        {context === "connection" && (
          <Button
            disabled={Boolean(pending)}
            busy={pending === "connect"}
            onClick={() => void run({ type: "connect", environmentId: view.id })}
          >
            {t("serversRetry", "Retry")}
          </Button>
        )}
      </div>
      {copyState === "failed" && (
        <span className="type-label-default">
          {t("serversCopyFailed", "Could not copy. Select and copy the command above.")}
        </span>
      )}
      <ServerActionError error={error} />
    </section>
  );
}
