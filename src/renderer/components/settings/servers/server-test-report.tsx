import type { ProbeReport } from "@contract/environment-commands";
import type { EnvironmentView } from "@contract/environment";
import { useI18n } from "@/i18n";
import { ServerDiagnosisCard } from "./server-diagnosis-card";
import { serverPanelStyle } from "./server-ui";

export function ServerTestReport({
  report,
  view,
  onEdit,
}: {
  report: ProbeReport;
  view: EnvironmentView;
  onEdit: (field: "remoteStateDir", suggestedValue: string) => void;
}) {
  const { t, language } = useI18n();
  const failure = report.failure;
  return (
    <section
      aria-live="polite"
      style={{
        ...serverPanelStyle,
        display: "grid",
        gap: "var(--space-2)",
        padding: "var(--space-3)",
        background: failure ? "var(--fx-status-danger-soft)" : "var(--fx-status-success-soft)",
      }}
    >
      <strong
        className="type-body-medium"
        style={{ color: failure ? "var(--fx-status-danger-text)" : "var(--fx-status-success-text)" }}
      >
        {failure ? t("serversTestFailed", "Connection test failed") : t("serversTestPassed", "Connection test passed")}
      </strong>
      <dl
        className="type-label-default"
        style={{
          display: "grid",
          gridTemplateColumns: "auto minmax(0, 1fr)",
          gap: "var(--space-1) var(--space-3)",
          margin: 0,
          color: "var(--fx-text-secondary)",
        }}
      >
        <dt>{t("serversLatency", "Latency")}</dt>
        <dd style={{ margin: 0 }}>
          {report.latencyMs === null ? t("serversUnknown", "Unknown") : `${report.latencyMs} ms`}
        </dd>
        <dt>{t("serversNodeRuntime", "Node.js")}</dt>
        <dd style={{ margin: 0 }}>{report.nodeVersion ?? t("serversUnknown", "Unknown")}</dd>
        {view.target.kind === "ssh" && (
          <>
            <dt>{t("serversRemoteStateDir", "Remote data directory")}</dt>
            <dd className="type-mono-meta" style={{ margin: 0, overflowWrap: "anywhere" }}>
              {view.target.remoteStateDir || "~/.dexon"}
            </dd>
          </>
        )}
        <dt>{t("serversDaemon", "Remote daemon")}</dt>
        <dd style={{ margin: 0 }}>
          {report.daemon
            ? report.daemon.running
              ? t("serversDaemonRunning", "Daemon is running")
              : t("serversDaemonStopped", "Daemon is not running")
            : t("serversUnknown", "Unknown")}
        </dd>
        {report.daemon?.since != null && (
          <>
            <dt>{t("serversDaemonStarted", "Started")}</dt>
            <dd style={{ margin: 0 }}>{new Date(report.daemon.since).toLocaleString(language)}</dd>
          </>
        )}
      </dl>
      {failure?.kind === "transient" && (
        <p
          role="alert"
          className="type-body-default"
          style={{ margin: 0, overflowWrap: "anywhere", color: "var(--fx-status-danger-text)" }}
        >
          {failure.failure.detail}
        </p>
      )}
      {failure?.kind === "blocked" && (
        <ServerDiagnosisCard context="probe" diagnosis={failure.diagnosis} view={view} onEdit={onEdit} />
      )}
    </section>
  );
}
