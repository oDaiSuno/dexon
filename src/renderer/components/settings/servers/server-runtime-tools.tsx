import type { EnvironmentView } from "@contract/environment";
import { useI18n } from "@/i18n";
import { Button } from "../../form-controls";
import { serverPanelStyle, serverRowStyle } from "./server-ui";

export function ServerRuntimeDetails({
  view,
  initiallyOpen = false,
}: {
  view: EnvironmentView;
  initiallyOpen?: boolean;
}) {
  const { t, language } = useI18n();
  const runtime = view.runtime;
  return (
    <details open={initiallyOpen || undefined} style={{ ...serverPanelStyle, padding: "var(--space-3)" }}>
      <summary className="type-label-medium" style={{ cursor: "pointer", color: "var(--fx-text-secondary)" }}>
        {t("schemeCServersRuntimeDetails", "Runtime details")}
      </summary>
      {runtime ? (
        <dl
          className="type-label-default"
          style={{
            display: "grid",
            gridTemplateColumns: "auto minmax(0, 1fr)",
            gap: "var(--space-2) var(--space-3)",
            margin: "var(--space-3) 0 0",
            color: "var(--fx-text-tertiary)",
            overflowWrap: "anywhere",
          }}
        >
          <dt>{t("serversNodeRuntime", "Node.js")}</dt>
          <dd className="type-mono-meta" style={{ margin: 0 }}>
            {runtime.nodeVersion}
          </dd>
          <dt>{t("schemeCServersPayloadVersion", "Remote service version")}</dt>
          <dd className="type-mono-meta" style={{ margin: 0 }}>
            {runtime.payloadVersion}
          </dd>
          <dt>{t("serversDaemonStarted", "Started")}</dt>
          <dd style={{ margin: 0 }}>{new Date(runtime.startedAt).toLocaleString(language)}</dd>
        </dl>
      ) : (
        <p className="type-label-default" style={{ marginBottom: 0, color: "var(--fx-text-tertiary)" }}>
          {t("schemeCServersRuntimeUnknown", "Connect to this server to load runtime details.")}
        </p>
      )}
    </details>
  );
}

export function ServerRestartConfirmation({
  pending,
  onConfirm,
  onCancel,
}: {
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  return (
    <section
      aria-label={t("schemeCRestartDaemon", "Restart remote daemon")}
      style={{
        ...serverPanelStyle,
        padding: "var(--space-3)",
        display: "grid",
        gap: "var(--space-3)",
        background: "var(--fx-status-warning-soft)",
      }}
    >
      <p className="type-label-default" style={{ margin: 0, color: "var(--fx-status-warning-text)" }}>
        {t("schemeCRestartWarning", "Running sessions and processes on this server will be interrupted.")}
      </p>
      <div style={{ ...serverRowStyle, justifyContent: "flex-end" }}>
        <Button disabled={pending} onClick={onCancel}>
          {t("schemeCServersCancelRestart", "Cancel restart")}
        </Button>
        <Button variant="danger" disabled={pending} busy={pending} onClick={onConfirm}>
          {t("schemeCConfirmRestart", "Confirm daemon restart")}
        </Button>
      </div>
    </section>
  );
}
