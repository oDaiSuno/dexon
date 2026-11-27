import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import { Button, Toggle } from "@/components/form-controls";
import { PageTopBar } from "@/components/page-top-bar";
import { requestAutomationAiSession, type AutomationTaskTab } from "@/lib/automation-request";
import { EmptyState, HostChip, OfflineHostNotice, StatusPill } from "./automation-atoms";
import { useAutomationWorkspace } from "./automation-context";
import { formatTrigger } from "./automation-format";
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
    const triggerSummary = revision.source.triggers.map(formatTrigger).join(" + ");
    const stepSummary = revision.source.steps.map((step) => step.title || step.id).join(" → ");
    const summaryParts = [
      triggerSummary,
      stepSummary ? `${revision.source.steps.length} · ${stepSummary}` : `${revision.source.steps.length}`,
    ].filter(Boolean);
    requestAutomationAiSession({
      mode: "modify",
      environmentId,
      cwd: task.cwd,
      taskId,
      taskName: task.name,
      revision: task.currentRevision,
      enabledRevision: task.enabledRevision,
      environmentLabel: host?.environment.label ?? environmentId,
      summary: summaryParts.join(" · "),
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
                    <div className="auto-page-inline">
                      <h1 className="auto-page-title type-title-hero">{title}</h1>
                      <StatusPill phase={enabled ? "enabled" : "paused"} />
                      {!enabled && (
                        <span className="automation-badge is-warning type-meta-micro">
                          {t("autoPageTaskDraftLabel", "Draft")} v{task.currentRevision}
                        </span>
                      )}
                    </div>
                    <div className="auto-page-task-metadata type-label-default">
                      <HostChip environmentId={environmentId} />
                      <span className="auto-page-trigger">
                        <AutomationIcon name="folder" size={13} />
                        <span className="auto-page-working-directory type-mono-label" title={task.cwd}>
                          {task.cwd}
                        </span>
                      </span>
                      {revision?.source.triggers.length ? (
                        <span className="auto-page-trigger">
                          <AutomationIcon name="clock" size={13} />
                          {revision.source.triggers.map(formatTrigger).join(" · ")}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="auto-page-task-actions">
                    <Toggle
                      checked={enabled}
                      aria-label={t("autoPageTaskEnableToggle", "Enable task")}
                      disabled={unavailable || !revision}
                      onChange={() => {
                        if (enabled) setPauseOpen(true);
                        else void enable();
                      }}
                    />
                    <span className="auto-page-vsep" aria-hidden="true" />
                    <Button
                      disabled={unavailable || !revision}
                      title={
                        !online
                          ? t("autoPageTaskAiOffline", "Reconnect this host to modify the task with AI.")
                          : undefined
                      }
                      onClick={modifyWithAi}
                    >
                      <AutomationIcon name="sparkles" size={14} />
                      {t("autoPageTaskModifyAi", "Modify with AI")}
                    </Button>
                    <Button
                      disabled={unavailable || !revision}
                      onClick={() => navigate({ view: "editor", environmentId, taskId })}
                    >
                      <AutomationIcon name="pencil" size={14} />
                      {t("autoPageTaskEdit", "Edit definition")}
                    </Button>
                    <Button
                      variant="primary"
                      disabled={unavailable || !enabled || !revision}
                      onClick={() => startTask(entry)}
                    >
                      <AutomationIcon name="play" size={14} />
                      {t("autoPageTaskRun", "Run now")}
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
                        className="auto-page-more-btn"
                        aria-label={t("autoPageTaskMore", "More task actions")}
                        aria-expanded={moreOpen}
                        aria-haspopup="menu"
                        disabled={pending}
                        onClick={() => setMoreOpen((value) => !value)}
                      >
                        <AutomationIcon name="more" size={15} />
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
                            <AutomationIcon name="trash" size={14} />
                            {t("autoPageTaskDelete", "Delete task")}
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                {revision?.source.description && (
                  <p className="type-body-default auto-page-secondary">{revision.source.description}</p>
                )}
                {!online && (
                  <p className="type-meta-default auto-page-muted">
                    {t("autoPageTaskAiOffline", "Reconnect this host to modify the task with AI.")}
                  </p>
                )}
              </header>
              {!enabled && (
                <section
                  className="auto-page-draft-banner"
                  aria-label={t("autoPageTaskDraftBanner", "Draft not enabled")}
                >
                  <div className="auto-page-draft-lead">
                    <AutomationIcon name="shield" size={16} />
                    <div className="auto-page-stack-tight">
                      <h2 className="type-body-medium">
                        {t("autoPageTaskDraftBanner", "Draft not enabled")} · v{task.currentRevision}
                      </h2>
                      <p className="type-label-default">
                        {t(
                          "autoPageTaskDraftExplanation",
                          "This revision is not enabled. Automatic triggers are paused. Existing runs continue with their original revision and permissions.",
                        )}
                      </p>
                      {revision && <TaskPermissionSummary grant={revision.requiredGrant} />}
                    </div>
                  </div>
                  <Button busy={busy} disabled={unavailable || !revision} onClick={() => void enable()}>
                    <AutomationIcon name="shield" size={14} />
                    {t("autoPageTaskEnable", "Enable revision")} v{task.currentRevision}
                  </Button>
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
                    {option.id === "runs" && (
                      <span className="auto-page-tab-count type-mono-meta">{taskRuns.runs.length}</span>
                    )}
                    {option.id === "flow" && revision && (
                      <span className="type-mono-meta auto-page-muted">{revision.source.steps.length}</span>
                    )}
                    {option.id === "revisions" && (
                      <span className="type-mono-meta auto-page-muted">
                        {task.currentRevision > 1 ? `v1–v${task.currentRevision}` : `v${task.currentRevision}`}
                      </span>
                    )}
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
