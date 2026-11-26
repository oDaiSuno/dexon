import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import { Button, Toggle } from "@/components/form-controls";
import { PageTopBar } from "@/components/page-top-bar";
import { requestAutomationAiSession, type AutomationTaskTab } from "@/lib/automation-request";
import { EmptyState, HostChip, OfflineHostNotice, StatusPill } from "./automation-atoms";
import { useAutomationWorkspace } from "./automation-context";
import { formatJson, formatTrigger } from "./automation-format";
import { AutomationIcon } from "./automation-icons";
import { AutomationRunList } from "./AutomationRunList";
import { DeleteTaskDialog } from "./DeleteTaskDialog";
import { taskError, useTaskEntry, useTaskRuns } from "./task-data";
import { TaskFlow, TaskPermissionSummary } from "./task-flow";
import { TaskRevisions } from "./task-revisions";

interface TaskDetailProps {
  environmentId: string;
  taskId: string;
  tab?: AutomationTaskTab;
}

function PauseTaskDialog({
  busy,
  error,
  onClose,
  onConfirm,
}: {
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="auto-page-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="auto-page-stack">
        <h2 id={titleId} className="type-body-large-medium">
          {t("autoPageTaskPauseTitle", "Pause this task?")}
        </h2>
        <p className="type-body-default">
          {t(
            "autoPageTaskPauseExplanation",
            "Automatic triggers will stop starting new runs. Runs already in progress are unaffected and keep their original revision.",
          )}
        </p>
        {error && (
          <p role="alert" className="auto-page-error type-body-default">
            {error}
          </p>
        )}
        <div className="auto-page-actions">
          <Button disabled={busy} onClick={onClose}>
            {t("autoPageTaskCancel", "Cancel")}
          </Button>
          <Button variant="danger" busy={busy} disabled={busy} onClick={onConfirm}>
            {t("autoPageTaskConfirmPause", "Pause task")}
          </Button>
        </div>
      </div>
    </dialog>
  );
}

function TaskDetailContent({ environmentId, taskId, tab = "runs" }: TaskDetailProps) {
  const { t } = useI18n();
  const { call, command, navigate, onClose, startTask, refresh, notify, nativeConsentPending } =
    useAutomationWorkspace();
  const { entry, host, online, loading, revisionLoading, error, reload } = useTaskEntry(environmentId, taskId);
  const taskRuns = useTaskRuns(environmentId, taskId, online);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const tabId = useId();
  const task = entry?.task;
  const revision = entry?.revision;
  const enabled = Boolean(task && task.enabledRevision === task.currentRevision);
  const pending = busy || Boolean(nativeConsentPending);
  const unavailable = !online || pending;
  const title = task?.name ?? t("autoPageTaskTitle", "Task");
  const tabs = [
    { id: "runs", label: t("autoPageTaskTabRuns", "Runs") },
    { id: "flow", label: t("autoPageTaskTabFlow", "Flow") },
    { id: "revisions", label: t("autoPageTaskTabRevisions", "Revisions") },
  ] as const;

  useEffect(() => {
    if (!moreOpen) return;
    overflowRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !overflowRef.current?.contains(event.target)) setMoreOpen(false);
    };
    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
  }, [moreOpen]);

  const enable = async () => {
    if (!task || !revision || !online || busyRef.current || nativeConsentPending) return;
    busyRef.current = true;
    setBusy(true);
    setActionError(null);
    try {
      const result = await command(
        {
          type: "enable-task",
          environmentId,
          taskId,
          revision: task.currentRevision,
          planHash: revision.planHash,
        },
        t("autoPageTaskEnable", "Enable revision"),
      );
      if (result.outcome === "enabled") {
        notify(t("autoPageTaskEnabledNotice", "This revision is now enabled."));
        await refresh();
        reload();
      }
    } catch (failure) {
      setActionError(taskError(failure));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const pause = async () => {
    if (!online || busyRef.current || nativeConsentPending) return;
    busyRef.current = true;
    setBusy(true);
    setActionError(null);
    try {
      await call(environmentId, "automation.disableTask", { taskId });
      setPauseOpen(false);
      notify(t("autoPageTaskPausedNotice", "Task paused. Existing runs are unaffected."));
      await refresh();
      reload();
    } catch (failure) {
      setActionError(taskError(failure));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const modifyWithAi = () => {
    if (!task || !revision || !online || pending) return;
    requestAutomationAiSession({
      mode: "modify",
      environmentId,
      cwd: task.cwd,
      taskId,
      taskName: task.name,
      revision: task.currentRevision,
      enabledRevision: task.enabledRevision,
      environmentLabel: host?.environment.label ?? environmentId,
      summary: formatJson({ source: revision.source, requiredGrant: revision.requiredGrant }),
    });
  };

  return (
    <section className="auto-page auto-page-task-detail">
      <PageTopBar
        parent={t("autoPageTaskBreadcrumb", "Automations")}
        current={title}
        isMobile={false}
        onParent={() => navigate({ view: "overview" })}
        onBack={onClose}
      />
      <div className="auto-page-scroll">
        <div className="auto-page-content auto-page-stack">
          <OfflineHostNotice environmentId={environmentId} />
          {actionError && !pauseOpen && (
            <div role="alert" className="auto-page-error type-body-default">
              {actionError}
            </div>
          )}
          {!entry && loading && <EmptyState>{t("autoPageTaskLoading", "Loading task…")}</EmptyState>}
          {!entry && !loading && (
            <section className="auto-page-panel auto-page-stack">
              <EmptyState>
                {error ??
                  (!online
                    ? t("autoPageTaskLoadOffline", "Reconnect this host to load the task.")
                    : t("autoPageTaskNotFound", "This task could not be found on this host."))}
              </EmptyState>
              <Button disabled={!online} onClick={reload}>
                {t("autoPageTaskRetry", "Try again")}
              </Button>
            </section>
          )}
          {entry && task && (
            <>
              <header className="auto-page-task-header auto-page-stack">
                <div className="auto-page-task-heading">
                  <div className="auto-page-stack-tight">
                    <h1 className="auto-page-title type-title-page">{title}</h1>
                    <div className="auto-page-inline">
                      <StatusPill phase={enabled ? "enabled" : "paused"} />
                      <span className="type-label-default">
                        {!enabled && t("autoPageTaskDraftLabel", "Draft")} v{task.currentRevision}
                      </span>
                      <HostChip environmentId={environmentId} />
                    </div>
                  </div>
                  <label className="auto-page-toggle-label type-label-medium">
                    <span>{t("autoPageTaskEnableToggle", "Enable task")}</span>
                    <Toggle
                      checked={enabled}
                      disabled={unavailable || !revision}
                      onChange={() => {
                        if (enabled) setPauseOpen(true);
                        else void enable();
                      }}
                    />
                  </label>
                </div>
                {revision?.source.description && <p className="type-body-default">{revision.source.description}</p>}
                <div className="auto-page-task-metadata type-meta-default">
                  <span className="auto-page-working-directory type-mono-label" title={task.cwd}>
                    {task.cwd}
                  </span>
                  {revision?.source.triggers.map((trigger) => (
                    <span key={trigger.id} className="auto-page-trigger">
                      <AutomationIcon name="clock" />
                      {formatTrigger(trigger)}
                    </span>
                  ))}
                </div>
                <div className="auto-page-actions">
                  <Button
                    variant="primary"
                    disabled={unavailable || !enabled || !revision}
                    onClick={() => startTask(entry)}
                  >
                    <AutomationIcon name="play" />
                    {t("autoPageTaskRun", "Run now")}
                  </Button>
                  <Button
                    disabled={unavailable || !revision}
                    title={
                      !online
                        ? t("autoPageTaskAiOffline", "Reconnect this host to modify the task with AI.")
                        : undefined
                    }
                    onClick={modifyWithAi}
                  >
                    <AutomationIcon name="sparkles" />
                    {t("autoPageTaskModifyAi", "Modify with AI")}
                  </Button>
                  <Button
                    disabled={unavailable || !revision}
                    onClick={() => navigate({ view: "editor", environmentId, taskId })}
                  >
                    <AutomationIcon name="code" />
                    {t("autoPageTaskEdit", "Edit definition")}
                  </Button>
                  <div
                    ref={overflowRef}
                    className="auto-page-overflow"
                    onKeyDown={(event) => {
                      if (event.key !== "Escape" || !moreOpen) return;
                      event.preventDefault();
                      event.stopPropagation();
                      setMoreOpen(false);
                      overflowRef.current?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')?.focus();
                    }}
                    onBlur={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget)) setMoreOpen(false);
                    }}
                  >
                    <Button
                      variant="ghost"
                      aria-label={t("autoPageTaskMore", "More task actions")}
                      aria-expanded={moreOpen}
                      aria-haspopup="menu"
                      disabled={pending}
                      onClick={() => setMoreOpen((value) => !value)}
                    >
                      <AutomationIcon name="more" />
                    </Button>
                    {moreOpen && (
                      <div className="auto-page-overflow-menu" role="menu">
                        <Button
                          role="menuitem"
                          variant="danger"
                          disabled={unavailable}
                          onClick={() => {
                            setMoreOpen(false);
                            setDeleteOpen(true);
                          }}
                        >
                          <AutomationIcon name="trash" />
                          {t("autoPageTaskDelete", "Delete task")}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
                {!online && (
                  <p className="type-meta-default">
                    {t("autoPageTaskAiOffline", "Reconnect this host to modify the task with AI.")}
                  </p>
                )}
              </header>
              {!enabled && (
                <section
                  className="auto-page-draft-banner auto-page-stack"
                  aria-label={t("autoPageTaskDraftBanner", "Draft not enabled")}
                >
                  <div className="auto-page-section-heading">
                    <h2 className="type-body-medium">
                      {t("autoPageTaskDraftBanner", "Draft not enabled")} · v{task.currentRevision}
                    </h2>
                    <Button
                      variant="primary"
                      busy={busy}
                      disabled={unavailable || !revision}
                      onClick={() => void enable()}
                    >
                      <AutomationIcon name="key" />
                      {t("autoPageTaskEnable", "Enable revision")}
                    </Button>
                  </div>
                  <p className="type-body-default">
                    {t(
                      "autoPageTaskDraftExplanation",
                      "This revision is not enabled. Automatic triggers are paused. Existing runs continue with their original revision and permissions.",
                    )}
                  </p>
                  <p className="type-meta-default">
                    {t(
                      "autoPageTaskNativeEnableHint",
                      "Enabling requires your approval in the system confirmation window.",
                    )}
                  </p>
                  {revision && <TaskPermissionSummary grant={revision.requiredGrant} />}
                </section>
              )}
              {!revision && (
                <div className="auto-page-notice type-body-default" role="status">
                  <span>
                    {error ??
                      (revisionLoading
                        ? t("autoPageTaskLoadingDefinition", "Loading this revision’s definition…")
                        : t(
                            "autoPageTaskDefinitionUnavailable",
                            "The current revision’s definition is unavailable. Reconnect or refresh before making changes.",
                          ))}
                  </span>
                  <Button disabled={!online || revisionLoading} onClick={reload}>
                    {t("autoPageTaskRetry", "Try again")}
                  </Button>
                </div>
              )}
              <div className="auto-page-tabs" role="tablist" aria-label={t("autoPageTaskTabs", "Task sections")}>
                {tabs.map((option) => (
                  <Button
                    key={option.id}
                    variant="ghost"
                    role="tab"
                    id={`${tabId}-${option.id}`}
                    aria-selected={tab === option.id}
                    aria-controls={`${tabId}-panel`}
                    onClick={() => navigate({ view: "task", environmentId, taskId, tab: option.id })}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
              <div
                id={`${tabId}-panel`}
                role="tabpanel"
                aria-labelledby={`${tabId}-${tab}`}
                className="auto-page-stack"
              >
                {tab === "runs" && (
                  <>
                    {taskRuns.loading && <EmptyState>{t("autoPageTaskLoadingRuns", "Loading runs…")}</EmptyState>}
                    {taskRuns.error && (
                      <div className="auto-page-error type-body-default" role="alert">
                        {taskRuns.error}
                      </div>
                    )}
                    {!taskRuns.loading && <AutomationRunList runs={taskRuns.runs} completed showHost={false} />}
                  </>
                )}
                {tab === "flow" && revision && (
                  <TaskFlow environmentId={environmentId} revision={revision} online={online} />
                )}
                {tab === "revisions" && (
                  <TaskRevisions key={`${environmentId}:${taskId}`} entry={entry} online={online} />
                )}
              </div>
            </>
          )}
        </div>
      </div>
      {pauseOpen && (
        <PauseTaskDialog
          busy={pending}
          error={actionError}
          onClose={() => setPauseOpen(false)}
          onConfirm={() => void pause()}
        />
      )}
      {deleteOpen && entry && (
        <DeleteTaskDialog
          entry={entry}
          onClose={() => setDeleteOpen(false)}
          onDeleted={() => {
            setDeleteOpen(false);
            navigate({ view: "overview" });
          }}
        />
      )}
    </section>
  );
}

export function AutomationTaskDetail(props: TaskDetailProps) {
  return <TaskDetailContent key={JSON.stringify([props.environmentId, props.taskId])} {...props} />;
}
