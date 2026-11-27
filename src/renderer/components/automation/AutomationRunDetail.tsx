import { useEffect, useRef, useState } from "react";
import type { EnvironmentId } from "@contract/environment";
import { useI18n } from "@/i18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { Button } from "../form-controls";
import { PageTopBar } from "../page-top-bar";
import { useAutomationWorkspace } from "./automation-context";
import { EmptyState, HostChip, JsonBlock, OfflineHostNotice, StatusPill } from "./automation-atoms";
import { AutomationIcon } from "./automation-icons";
import { formatDateTime, formatDuration, formatTrigger, isActivePhase } from "./automation-format";
import { AutomationRunStep } from "./AutomationRunStep";
import { useRunDetailData } from "./run-detail-data";
import { errorMessage } from "./run-values";

interface AutomationRunDetailProps {
  environmentId: EnvironmentId;
  taskId: string;
  runId: string;
}

export function AutomationRunDetail(props: AutomationRunDetailProps) {
  return <RunDetail key={JSON.stringify([props.environmentId, props.taskId, props.runId])} {...props} />;
}

function RunDetail({ environmentId, taskId, runId }: AutomationRunDetailProps) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const { tasks, inbox, call, refresh, navigate, notify, onClose } = useAutomationWorkspace();
  const { run, revision, error, revisionError, loading, online, reload } = useRunDetailData(
    environmentId,
    taskId,
    runId,
  );
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [, setClock] = useState(0);
  const cancelling = useRef(false);
  const active = !!run && isActivePhase(run.phase);
  const taskName =
    revision?.source.name ??
    tasks.find((entry) => entry.environmentId === environmentId && entry.task.id === taskId)?.task.name ??
    taskId;

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setClock((clock) => clock + 1), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);

  const changed = () => {
    reload();
    void refresh().catch((err: unknown) => notify(errorMessage(err)));
  };

  const cancel = async () => {
    if (cancelling.current || !run || !active || !online || run.phase === "cancelling") return;
    cancelling.current = true;
    setCancelBusy(true);
    setCancelError(null);
    try {
      const result = await call(environmentId, "automation.cancelRun", { runId });
      setCancelConfirm(false);
      notify(
        result.run.phase === "attention"
          ? t("autoPageRunCancelReview", "Cancellation needs a check of external effects. Review the highlighted step.")
          : t("autoPageRunCancelRequested", "Cancellation requested. The timeline will show the final result."),
      );
      changed();
    } catch (err) {
      setCancelError(errorMessage(err));
    } finally {
      cancelling.current = false;
      setCancelBusy(false);
    }
  };

  const backToTask = () => navigate({ view: "task", environmentId, taskId, tab: "runs" });
  const steps = revision?.source.steps ?? [];
  const indexes = [
    ...new Set([
      ...steps.map((_, index) => index),
      ...(run?.steps.map((step) => step.stepIndex) ?? []),
      ...(run?.attempts.map((attempt) => attempt.stepIndex) ?? []),
    ]),
  ].sort((a, b) => a - b);
  const inboxEntries = inbox.filter((entry) => entry.environmentId === environmentId && entry.item.runId === runId);
  const waitingStep = run?.steps.find((step) => step.status === "waiting");
  const currentIndex =
    run?.phase === "attention"
      ? (inboxEntries[0]?.item.stepIndex ?? run.steps.find((step) => step.status === "unknown")?.stepIndex)
      : (waitingStep?.stepIndex ?? indexes.find((index) => !run?.steps.some((step) => step.stepIndex === index)));
  const completed = run?.steps.filter((step) => step.status === "done").length ?? 0;
  const triggerFact = run?.triggerFact;
  const triggerId =
    triggerFact &&
    typeof triggerFact === "object" &&
    !Array.isArray(triggerFact) &&
    typeof triggerFact.triggerId === "string"
      ? triggerFact.triggerId
      : null;
  const trigger = revision?.source.triggers.find((entry) => entry.id === triggerId);
  const triggerLabel = trigger
    ? formatTrigger(trigger)
    : (triggerId ?? t("autoPageRunTriggerUnknown", "See trigger details"));

  return (
    <section className="auto-page-view auto-page-run-detail">
      <PageTopBar
        parent={`${t("autoPageRunAutomation", "Automation")} · ${taskName}`}
        current={`${t("autoPageRunTitle", "Run")} ${runId}`}
        isMobile={isMobile}
        onParent={backToTask}
        onBack={onClose}
      />
      <div className="auto-page-content auto-page-run-content">
        <OfflineHostNotice environmentId={environmentId} />
        <header className="auto-page-run-header">
          <div className="auto-page-run-heading">
            <div className="auto-page-run-title-row">
              <h1 className="type-title-page">
                {t("autoPageRunTitle", "Run")} <span className="type-mono-number-strong">{runId}</span>
              </h1>
              {run && <StatusPill phase={run.phase} waitKind={waitingStep?.waitKind} />}
              <HostChip environmentId={environmentId} />
            </div>
            {run && (
              <div className="auto-page-run-meta-strip type-label-default">
                <span>{triggerLabel}</span>
                <span className="type-mono-label">
                  {t("autoPageRunRevision", "Revision")} v{run.revision}
                </span>
                <span className="type-mono-label auto-page-run-muted">
                  {formatDateTime(run.admittedAtMs ?? run.createdAtMs)}
                </span>
                <span className={`type-mono-label-strong${active ? " auto-page-warning" : " auto-page-run-muted"}`}>
                  {t("autoPageRunDuration", "Elapsed")}{" "}
                  {formatDuration(run.admittedAtMs ?? run.createdAtMs, run.endedAtMs)}
                </span>
                {run.laneKey !== null && <span className="type-mono-meta auto-page-run-muted">{run.laneKey}</span>}
              </div>
            )}
          </div>
          <div className="auto-page-run-actions">
            <Button variant="ghost" disabled={!online || loading} busy={loading} onClick={changed}>
              {t("autoPageRunRefresh", "Refresh")}
            </Button>
            {active && run?.phase !== "cancelling" && (
              <Button disabled={!online || cancelBusy} onClick={() => setCancelConfirm(true)}>
                <AutomationIcon name="square" size={13} />
                {t("autoPageRunCancel", "Cancel this run")}
              </Button>
            )}
          </div>
        </header>
        {error && (
          <p className="auto-page-run-error type-body-default" role="alert">
            {error}
          </p>
        )}
        {cancelError && (
          <p className="auto-page-run-error type-body-default" role="alert">
            {cancelError}
          </p>
        )}
        {cancelConfirm && active && (
          <div
            className="auto-page-run-cancel-confirm"
            role="group"
            aria-label={t("autoPageRunCancelConfirm", "Confirm run cancellation")}
          >
            <p className="type-body-default">
              {t(
                "autoPageRunCancelHelp",
                "Cancel only this run. Task schedules stay enabled. If an external action may already have happened, you will still need to review its result.",
              )}
            </p>
            <div className="auto-page-run-actions">
              <Button disabled={cancelBusy} onClick={() => setCancelConfirm(false)}>
                {t("autoPageRunKeepRunning", "Keep running")}
              </Button>
              <Button variant="danger" busy={cancelBusy} disabled={cancelBusy || !online} onClick={() => void cancel()}>
                {cancelBusy
                  ? t("autoPageRunCancelling", "Requesting cancellation…")
                  : t("autoPageRunConfirmCancel", "Confirm cancellation")}
              </Button>
            </div>
          </div>
        )}
        {!run && (
          <EmptyState>
            {loading
              ? t("autoPageRunLoading", "Loading run details…")
              : online
                ? t("autoPageRunUnavailable", "Run details are unavailable. Refresh to try again.")
                : t("autoPageRunOffline", "Reconnect this host to load the run timeline.")}
          </EmptyState>
        )}
        {run && (
          <>
            {run.phase === "pending" && (
              <p className="auto-page-run-notice type-body-default" role="status">
                {t(
                  "autoPageRunQueuedHelp",
                  "Queued until the task's concurrency lane has room. No steps have started.",
                )}
              </p>
            )}
            {run.phase === "cancelling" && (
              <p className="auto-page-run-notice type-body-default" data-tone="warning" role="status">
                {t(
                  "autoPageRunCancellingHelp",
                  "The host is stopping active work. External actions may need a final check before cancellation completes.",
                )}
              </p>
            )}
            {run.phase === "superseded" && (
              <p className="auto-page-run-notice type-body-default">
                {t(
                  "autoPageRunSupersededHelp",
                  "A newer pending run replaced this queued run under the task's latest-only policy. This run did not execute.",
                )}
              </p>
            )}
            {revisionError && (
              <p className="auto-page-run-notice type-body-default" data-tone="warning" role="alert">
                {t(
                  "autoPageRunRevisionMissing",
                  "The run's exact revision could not be loaded. Only recorded steps are shown; refresh to see the full flow.",
                )}{" "}
                {revisionError}
              </p>
            )}
            <section className="auto-page-run-timeline-section" aria-labelledby="auto-page-run-timeline-title">
              <header className="auto-page-run-timeline-header">
                <h2 id="auto-page-run-timeline-title" className="type-heading">
                  {t("autoPageRunTimeline", "Execution timeline")}
                </h2>
                <span className="auto-page-run-muted type-label-default">
                  {t("autoPageRunStepsComplete", "Completed steps:")} {completed} / {revision ? steps.length : "—"}
                </span>
              </header>
              {indexes.length === 0 ? (
                <EmptyState>{t("autoPageRunNoStepRecords", "No step records are available yet.")}</EmptyState>
              ) : (
                <ol className="auto-page-run-timeline">
                  {indexes.map((index) => (
                    <AutomationRunStep
                      key={index}
                      environmentId={environmentId}
                      run={run}
                      taskName={taskName}
                      stepIndex={index}
                      spec={steps[index]}
                      record={run.steps.find((step) => step.stepIndex === index)}
                      attempts={run.attempts.filter((attempt) => attempt.stepIndex === index)}
                      current={index === currentIndex}
                      inboxEntry={inboxEntries.find((entry) => entry.item.stepIndex === index)}
                      onChanged={changed}
                    />
                  ))}
                </ol>
              )}
            </section>
            <details className="auto-page-run-context">
              <summary className="type-label-medium">
                {t("autoPageRunInputContext", "Run input and trigger details")}
              </summary>
              <div className="auto-page-run-detail-stack">
                <h3 className="type-label-medium">{t("autoPageRunInput", "Run input")}</h3>
                <JsonBlock value={run.input} />
                <h3 className="type-label-medium">{t("autoPageRunTriggerFact", "Recorded trigger")}</h3>
                <JsonBlock value={run.triggerFact} />
                {run.dedupeKey !== null && (
                  <div className="type-mono-label">
                    {t("autoPageRunDedupeKey", "Deduplication key:")} {run.dedupeKey}
                  </div>
                )}
                {revision && <div className="auto-page-run-muted type-mono-label">{revision.source.cwd}</div>}
              </div>
            </details>
            {run.end !== null && (
              <details className="auto-page-run-context">
                <summary className="type-label-medium">{t("autoPageRunFinalResult", "Final run result")}</summary>
                <JsonBlock value={run.end} />
              </details>
            )}
          </>
        )}
      </div>
    </section>
  );
}
