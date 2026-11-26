import type { EnvironmentId } from "@contract/environment";
import type { StepSpec } from "@shared/automation/spec";
import type { AttemptView, RunDetailView, StepView } from "@shared/automation/views";
import { useI18n } from "@/i18n";
import { requestSealedAutomationSession } from "@/lib/automation-request";
import { Badge, Button } from "../form-controls";
import { useAutomationWorkspace, type HostedInbox } from "./automation-context";
import { JsonBlock, StatusPill } from "./automation-atoms";
import { AutomationIcon } from "./automation-icons";
import { formatDateTime, formatDuration, formatRelativeTime, formatStepKind, isActivePhase } from "./automation-format";
import { InboxResolutionForm } from "./InboxResolutionForm";
import { AutomationSignalAction } from "./AutomationSignalAction";
import { attemptOutput, outputPreview } from "./run-values";

export function AutomationRunStep({
  environmentId,
  run,
  taskName,
  stepIndex,
  spec,
  record,
  attempts,
  current,
  inboxEntry,
  onChanged,
}: {
  environmentId: EnvironmentId;
  run: RunDetailView;
  taskName: string;
  stepIndex: number;
  spec?: StepSpec;
  record?: StepView;
  attempts: readonly AttemptView[];
  current: boolean;
  inboxEntry?: HostedInbox;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const { onClose } = useAutomationWorkspace();
  const history = [...attempts].sort((a, b) => a.attemptNo - b.attemptNo);
  const latest = history.at(-1);
  const openAttempt = history.find((attempt) => attempt.settledAtMs === null);
  const live = isActivePhase(run.phase);
  const waiting = live && record?.status === "waiting";
  const backoff = current && run.phase === "backoff";
  const running = !!openAttempt && live;
  const untouched = !record && history.length === 0;
  const phase =
    record?.status === "done"
      ? "succeeded"
      : record?.status === "failed"
        ? "failed"
        : record?.status === "unknown"
          ? "attention"
          : waiting
            ? "waiting"
            : backoff
              ? "backoff"
              : running
                ? run.phase === "cancelling"
                  ? "cancelling"
                  : "running"
                : current && live
                  ? run.phase
                  : "pending";
  const startedAt = history[0]?.startedAtMs ?? record?.openedAtMs;
  const endedAt = record?.settledAtMs ?? run.endedAtMs;
  const output = record?.status === "done" ? record.output : latest ? attemptOutput(latest) : undefined;
  const preview = output === undefined ? [] : outputPreview(output);
  const title = spec?.title || spec?.id || record?.stepId || `${t("autoPageRunStep", "Step")} ${stepIndex + 1}`;
  const stepId = spec?.id ?? record?.stepId;
  const icon =
    record?.status === "done"
      ? "check"
      : record?.status === "failed" || record?.status === "unknown"
        ? "alert"
        : waiting || backoff
          ? "clock"
          : running && spec?.kind === "agent"
            ? "sparkles"
            : "right";
  const activeInbox = inboxEntry && live ? inboxEntry : undefined;
  const tone =
    phase === "succeeded"
      ? "success"
      : phase === "failed" || phase === "attention"
        ? "danger"
        : phase === "running"
          ? "accent"
          : phase === "waiting" || phase === "backoff" || phase === "cancelling"
            ? "warning"
            : "muted";

  const openSession = (attempt: AttemptView) => {
    if (!attempt.sessionId) return;
    requestSealedAutomationSession({
      environmentId,
      sessionId: attempt.sessionId,
      taskId: run.taskId,
      taskName,
      runId: run.id,
      stepId,
    });
    onClose();
  };

  const outcomeLabel = (attempt: AttemptView) => {
    if (attempt.outcome === "committed") return t("autoPageRunAttemptCommitted", "Completed");
    if (attempt.outcome === "rejected_before_commit") return t("autoPageRunAttemptRejected", "Not applied");
    if (attempt.outcome === "retryable_within_window")
      return t("autoPageRunAttemptRetryable", "Retryable within the safe window");
    if (attempt.outcome === "outcome_unknown") return t("autoPageRunAttemptUnknown", "External result needs checking");
    return live
      ? t("autoPageRunAttemptRunning", "In progress")
      : t("autoPageRunAttemptUnsettled", "No final result recorded");
  };

  return (
    <li className="auto-page-run-step" data-phase={record?.status === "skipped" ? "skipped" : phase}>
      <div
        className="auto-page-run-step-marker"
        data-tone={record?.status === "skipped" ? "muted" : tone}
        aria-hidden="true"
      >
        <AutomationIcon name={icon} size={16} />
      </div>
      <article className="auto-page-run-step-content">
        <header className="auto-page-run-step-header">
          <div className="auto-page-run-step-heading">
            <span className="auto-page-run-muted type-mono-meta">{String(stepIndex + 1).padStart(2, "0")}</span>
            <h3 className="type-heading">{title}</h3>
            {spec && <Badge tone="neutral">{formatStepKind(spec)}</Badge>}
          </div>
          <div className="auto-page-run-step-meta">
            {record?.status === "skipped" ? (
              <Badge>{t("autoPageRunStepSkipped", "Skipped")}</Badge>
            ) : untouched && !live ? (
              <Badge>{t("autoPageRunStepNotReached", "Not executed")}</Badge>
            ) : untouched && !current ? (
              <Badge>{t("autoPageRunStepNotStarted", "Not started")}</Badge>
            ) : record?.status === "waiting" && !live ? (
              <Badge>{t("autoPageRunStepWaitEnded", "Wait ended with the run")}</Badge>
            ) : (
              <StatusPill phase={phase} waitKind={record?.waitKind} />
            )}
            {startedAt !== undefined && (
              <span className="auto-page-run-muted type-mono-meta" title={formatDateTime(startedAt)}>
                {formatDuration(startedAt, endedAt)}
              </span>
            )}
          </div>
        </header>
        {preview.length > 0 && (
          <div className="auto-page-run-output-chips">
            {preview.map((chip) => (
              <span className="auto-page-run-output-chip type-mono-meta" key={chip.key} title={chip.value}>
                {chip.key && <span className="auto-page-run-muted">{chip.key}: </span>}
                {chip.value.length > 100 ? `${chip.value.slice(0, 100)}…` : chip.value}
              </span>
            ))}
          </div>
        )}
        {backoff && (
          <p className="auto-page-run-notice type-label-default" data-tone="warning" role="status">
            {t("autoPageRunBackoffHelp", "Automatic retry is waiting, not stuck.")}{" "}
            {t("autoPageRunNextAttempt", "Next attempt:")} #{(latest?.attemptNo ?? 0) + 1}
            {run.wakeAtMs !== null && (
              <>
                {" "}
                · {formatRelativeTime(run.wakeAtMs)} · {formatDateTime(run.wakeAtMs)}
              </>
            )}
          </p>
        )}
        {waiting && record.waitKind === "duration" && (
          <p className="auto-page-run-notice type-label-default" role="status">
            {t("autoPageRunDelayHelp", "This step resumes automatically after the delay.")}
            {record.wakeAtMs !== null && (
              <>
                {" "}
                {formatRelativeTime(record.wakeAtMs)} · {formatDateTime(record.wakeAtMs)}
              </>
            )}
          </p>
        )}
        {record?.status === "skipped" && (
          <p className="auto-page-run-muted type-label-default">
            {t("autoPageRunSkippedHelp", "The step's condition was not met. Nothing was executed.")}
          </p>
        )}
        {untouched && !live && (
          <p className="auto-page-run-muted type-label-default">
            {run.phase === "superseded"
              ? t("autoPageRunSupersededStepHelp", "A newer queued run replaced this one before this step started.")
              : t("autoPageRunNotReachedHelp", "The run ended before reaching this step.")}
          </p>
        )}
        {untouched && current && (run.phase === "pending" || run.phase === "ready") && (
          <p className="auto-page-run-muted type-label-default">
            {run.phase === "pending"
              ? t("autoPageRunQueuedStepHelp", "Waiting for capacity. This step has not started yet.")
              : t("autoPageRunReadyStepHelp", "Ready to execute when the host takes the next step.")}
          </p>
        )}
        {waiting && record.expiresAtMs !== null && (
          <p className="auto-page-run-muted type-label-default">
            {t("autoPageRunWaitExpires", "Wait expires:")} {formatDateTime(record.expiresAtMs)} ·{" "}
            {formatRelativeTime(record.expiresAtMs)}
          </p>
        )}
        {activeInbox && <InboxResolutionForm entry={activeInbox} onResolved={onChanged} />}
        {waiting && record.waitKind === "signal" && spec?.kind === "wait" && spec.wait.kind === "signal" && (
          <AutomationSignalAction
            key={`${run.id}:${stepIndex}`}
            environmentId={environmentId}
            run={run}
            wait={spec.wait}
            record={record}
            taskName={taskName}
            onSent={onChanged}
          />
        )}
        {record?.error !== null && record?.error !== undefined && !activeInbox && (
          <div className="auto-page-run-step-error">
            <div className="type-label-medium">{t("autoPageRunStepError", "Step error")}</div>
            <JsonBlock value={record.error} />
          </div>
        )}
        {(history.length > 0 || spec || output !== undefined) && (
          <details className="auto-page-run-step-details">
            <summary className="type-label-medium">
              {history.length > 0 && (
                <>
                  {history.length} {t("autoPageRunAttempts", "attempts")} ·{" "}
                </>
              )}
              {t("autoPageRunInspectDetails", "Inspect configuration and results")}
            </summary>
            <div className="auto-page-run-detail-stack">
              {spec && (
                <details className="auto-page-run-config">
                  <summary className="type-label-medium">{t("autoPageRunStepConfig", "Configured step")}</summary>
                  <JsonBlock value={spec} />
                </details>
              )}
              {output !== undefined && (
                <section className="auto-page-run-detail-stack">
                  <h4 className="type-label-medium">{t("autoPageRunStepOutput", "Step output")}</h4>
                  <JsonBlock value={output} />
                </section>
              )}
              {history.length > 0 && (
                <p className="auto-page-run-muted type-label-default">
                  {t(
                    "autoPageRunAttemptSnapshotHelp",
                    "Attempts store their result or error, not a separate input snapshot. The configured step and run input are shown separately.",
                  )}
                </p>
              )}
              {history.map((attempt) => {
                const result = attemptOutput(attempt);
                return (
                  <section className="auto-page-run-attempt" key={attempt.attemptNo}>
                    <div className="auto-page-run-attempt-heading">
                      <h4 className="type-body-medium">
                        {t("autoPageRunAttempt", "Attempt")} #{attempt.attemptNo}
                      </h4>
                      <Badge
                        tone={
                          attempt.outcome === "committed" ? "success" : attempt.outcome === null ? "running" : "warning"
                        }
                      >
                        {outcomeLabel(attempt)}
                      </Badge>
                    </div>
                    <div className="auto-page-run-attempt-meta type-label-default">
                      <span>
                        {attempt.origin === "user_retry"
                          ? t("autoPageRunUserRetry", "User-requested retry")
                          : t("autoPageRunDriverAttempt", "Automatic execution")}
                      </span>
                      <time dateTime={new Date(attempt.startedAtMs).toISOString()}>
                        {formatDateTime(attempt.startedAtMs)}
                      </time>
                      <span className="type-mono-meta">
                        {formatDuration(attempt.startedAtMs, attempt.settledAtMs ?? run.endedAtMs)}
                      </span>
                    </div>
                    {attempt.detail !== null ? (
                      <div className="auto-page-run-detail-stack">
                        <div className="type-label-medium">
                          {result !== undefined
                            ? t("autoPageRunAttemptOutput", "Recorded output")
                            : t("autoPageRunAttemptDetail", "Recorded result / error")}
                        </div>
                        <JsonBlock value={result !== undefined ? result : attempt.detail} />
                        {result !== undefined && (
                          <details className="auto-page-run-config">
                            <summary className="type-label-default">
                              {t("autoPageRunAttemptRaw", "Full attempt record")}
                            </summary>
                            <JsonBlock value={attempt.detail} />
                          </details>
                        )}
                      </div>
                    ) : (
                      <p className="auto-page-run-muted type-label-default">
                        {t("autoPageRunAttemptNoDetail", "No result has been recorded yet.")}
                      </p>
                    )}
                    {attempt.sessionId && (
                      <Button variant="ghost" onClick={() => openSession(attempt)}>
                        <AutomationIcon name="sparkles" />
                        {t("autoPageRunSealedSession", "View sealed AI execution")}
                        <AutomationIcon name="right" />
                      </Button>
                    )}
                  </section>
                );
              })}
            </div>
          </details>
        )}
      </article>
    </li>
  );
}
