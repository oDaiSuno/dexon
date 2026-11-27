import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import { Button, Toggle } from "@/components/form-controls";
import { HostChip, StatusPill } from "./automation-atoms";
import { type HostedTask, useAutomationWorkspace } from "./automation-context";
import { formatDateTime, formatRelativeTime, formatTrigger, isActivePhase } from "./automation-format";
import { AutomationIcon } from "./automation-icons";

export function OverviewTaskTable({ tasks }: { tasks: readonly HostedTask[] }) {
  const { t } = useI18n();
  const { hosts, nativeConsentPending, command, call, refresh, notify, startTask, navigate } = useAutomationWorkspace();
  const [busy, setBusy] = useState<string | null>(null);
  const [disabling, setDisabling] = useState<HostedTask | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (disabling && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [disabling]);
  const closeDialog = () => {
    dialog.current?.close();
    setDisabling(null);
  };
  const update = async (entry: HostedTask, enable: boolean) => {
    const { environmentId, task, revision } = entry;
    if (
      busy ||
      nativeConsentPending ||
      hosts.find((host) => host.environment.id === environmentId)?.status !== "online"
    )
      return;
    setBusy(`${environmentId}:${task.id}`);
    try {
      if (enable) {
        if (!revision || revision.revision !== task.currentRevision) return;
        const result = await command(
          {
            type: "enable-task",
            environmentId,
            taskId: task.id,
            revision: revision.revision,
            planHash: revision.planHash,
          },
          task.name,
        );
        if (result.outcome === "cancelled") return;
      } else {
        await call(environmentId, "automation.disableTask", { taskId: task.id });
        closeDialog();
      }
      await refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <div className="auto-page-table-scroll">
        <table className="auto-page-table auto-page-task-table">
          <thead>
            <tr className="type-meta-caps">
              <th scope="col">{t("autoPageOverviewTask", "Task")}</th>
              <th scope="col">{t("autoPageOverviewHost", "Host")}</th>
              <th scope="col">{t("autoPageOverviewLatestRun", "Latest run")}</th>
              <th scope="col">{t("autoPageOverviewActions", "Actions")}</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((entry) => {
              const { environmentId, task, revision, latestRun } = entry;
              const enabled = task.enabledRevision !== null;
              const isDraftPaused = task.enabledRevision !== task.currentRevision;
              const hostStatus = hosts.find((host) => host.environment.id === environmentId)?.status ?? "offline";
              const unavailable = Boolean(busy || nativeConsentPending) || hostStatus !== "online";
              const manual = revision?.source.triggers.some((trigger) => trigger.kind === "manual");
              const hasWatch = revision?.source.triggers.some((trigger) => trigger.kind === "watch");
              const hasSchedule = revision?.source.triggers.some((trigger) => trigger.kind === "schedule");
              const running = Boolean(latestRun && isActivePhase(latestRun.phase));
              const iconName = hasWatch ? "radio" : hasSchedule ? "clock" : "shield";
              return (
                <tr key={`${environmentId}:${task.id}`}>
                  <td>
                    <div className="auto-page-task-cell">
                      <span
                        className="auto-page-task-icon"
                        data-active={running ? "true" : undefined}
                        aria-hidden="true"
                      >
                        <AutomationIcon name={iconName} size={15} />
                      </span>
                      <div className="auto-page-stack-tight">
                        <div className="auto-page-inline">
                          <Button
                            variant="ghost"
                            className="auto-page-text-button type-body-medium"
                            onClick={() => navigate({ view: "task", environmentId, taskId: task.id })}
                          >
                            {task.name || task.id}
                          </Button>
                          {isDraftPaused && (
                            <span className="automation-badge is-warning type-meta-micro">
                              {t("autoPageOverviewPausedDraft", "Paused · Draft")} v{task.currentRevision}
                            </span>
                          )}
                          {enabled && task.enabledRevision !== task.currentRevision && (
                            <span className="type-meta-default auto-page-muted">
                              {t("autoPageOverviewOlderEnabled", "Older revision enabled")} v{task.enabledRevision}
                            </span>
                          )}
                        </div>
                        <div className="auto-page-task-meta">
                          <span className="type-label-default auto-page-secondary">
                            {revision?.source.triggers.map(formatTrigger).join(" · ") ||
                              t("autoPageOverviewTriggersUnavailable", "Trigger details unavailable")}
                          </span>
                          <span className="type-label-default auto-page-muted" aria-hidden="true">
                            ·
                          </span>
                          <span className="type-mono-meta auto-page-muted">{task.cwd}</span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <HostChip environmentId={environmentId} />
                  </td>
                  <td>
                    {hostStatus !== "online" ? (
                      <StatusPill phase="offline" />
                    ) : latestRun ? (
                      <Button
                        variant="ghost"
                        className="auto-page-text-button auto-page-latest-run"
                        onClick={() => navigate({ view: "run", environmentId, taskId: task.id, runId: latestRun.id })}
                      >
                        <StatusPill phase={latestRun.phase} />
                        <time
                          className="type-mono-meta auto-page-muted"
                          dateTime={new Date(latestRun.createdAtMs).toISOString()}
                          title={formatDateTime(latestRun.createdAtMs)}
                        >
                          {formatRelativeTime(latestRun.createdAtMs)}
                        </time>
                        <AutomationIcon name="right" size={13} />
                      </Button>
                    ) : (
                      <span className="type-meta-default auto-page-muted">
                        {t("autoPageOverviewNeverRun", "Not run yet")}
                      </span>
                    )}
                  </td>
                  <td>
                    <div className="auto-page-row">
                      <Button
                        variant="ghost"
                        className="auto-page-icon-btn"
                        aria-label={t("autoPageOverviewRunManually", "Run manually")}
                        title={t("autoPageOverviewRunManually", "Run manually")}
                        disabled={unavailable || !enabled || !manual || task.enabledRevision !== task.currentRevision}
                        onClick={() => startTask(entry)}
                      >
                        <AutomationIcon name="play" size={13} />
                      </Button>
                      <Toggle
                        checked={enabled}
                        aria-label={
                          enabled
                            ? t("autoPageOverviewPauseTask", "Pause task")
                            : t("autoPageOverviewEnableTask", "Enable task")
                        }
                        disabled={
                          unavailable || (!enabled && (!revision || revision.revision !== task.currentRevision))
                        }
                        onChange={() => (enabled ? setDisabling(entry) : void update(entry, true))}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {disabling && (
        <dialog
          ref={dialog}
          className="auto-page-dialog"
          aria-labelledby="auto-page-overview-pause-title"
          aria-describedby="auto-page-overview-pause-description"
          onCancel={(event) => {
            if (busy) event.preventDefault();
            else setDisabling(null);
          }}
          onClose={() => setDisabling(null)}
        >
          <div className="auto-page-stack">
            <h2 id="auto-page-overview-pause-title" className="type-title-dialog">
              {t("autoPageOverviewPauseTitle", "Pause this task?")}
            </h2>
            <p className="type-body-medium">{disabling.task.name}</p>
            <p id="auto-page-overview-pause-description" className="type-body-default auto-page-muted">
              {t(
                "autoPageOverviewPauseDescription",
                "New triggers will stop firing. Runs already in progress, including runs from older revisions, will continue.",
              )}
            </p>
            <div className="auto-page-actions">
              <Button disabled={Boolean(busy)} onClick={closeDialog}>
                {t("autoPageOverviewCancel", "Cancel")}
              </Button>
              <Button
                variant="danger"
                busy={Boolean(busy)}
                disabled={
                  Boolean(busy || nativeConsentPending) ||
                  hosts.find((host) => host.environment.id === disabling.environmentId)?.status !== "online"
                }
                onClick={() => void update(disabling, false)}
              >
                {t("autoPageOverviewPauseTask", "Pause task")}
              </Button>
            </div>
          </div>
        </dialog>
      )}
    </>
  );
}
