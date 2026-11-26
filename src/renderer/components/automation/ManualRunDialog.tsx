import { useEffect, useRef, useState } from "react";
import type { TaskRevisionView, TaskView } from "@shared/automation/views";
import { useI18n } from "@/i18n";
import { Button, Field, NativeSelect } from "@/components/form-controls";
import { useAutomationWorkspace, type HostedTask } from "./automation-context";
import { HostChip, OfflineHostNotice } from "./automation-atoms";
import { AutomationIcon } from "./automation-icons";
import { SlideOverDrawer } from "./SlideOverDrawer";
import { DrawerSchemaInput, drawerSchemaDefault } from "./drawer-schema-input";
import { drawerError, parseDrawerJson, useDrawerRequestId } from "./drawer-utils";

export function ManualRunDialog({ entry, onClose }: { entry: HostedTask; onClose: () => void }) {
  const { t } = useI18n();
  const { hosts, call, refresh, navigate, notify } = useAutomationWorkspace();
  const [revision, setRevision] = useState<TaskRevisionView | null>(null);
  const [task, setTask] = useState<TaskView>(entry.task);
  const [triggerId, setTriggerId] = useState("");
  const [inputJson, setInputJson] = useState("null");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const pending = useRef(false);
  const attempt = useRef(0);
  const requestId = useDrawerRequestId();
  const { environmentId } = entry;
  const online = hosts.some((host) => host.environment.id === environmentId && host.status === "online");
  const manualTriggers = revision?.source.triggers.filter((trigger) => trigger.kind === "manual") ?? [];

  useEffect(() => {
    let active = true;
    setRevision(null);
    setTriggerId("");
    setError(null);
    setLoading(false);
    if (!online) return;
    setLoading(true);
    void (async () => {
      const { tasks } = await call(environmentId, "automation.listTasks");
      const liveTask = tasks.find((candidate) => candidate.id === entry.task.id);
      if (!liveTask) throw new Error(t("autoPageDrawerTaskMissing", "This task no longer exists."));
      if (!active) return;
      setTask(liveTask);
      if (liveTask.enabledRevision === null) return;
      const { task: snapshot } = await call(environmentId, "automation.getTask", {
        taskId: liveTask.id,
        revision: liveTask.enabledRevision,
      });
      if (!active) return;
      setRevision(snapshot);
      setTriggerId(snapshot.source.triggers.find((trigger) => trigger.kind === "manual")?.id ?? "");
      setInputJson(JSON.stringify(drawerSchemaDefault(snapshot.source.inputSchema), null, 2));
    })()
      .catch((err: unknown) => {
        if (active) setError(drawerError(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [call, environmentId, online, entry.task.id, entry.task.enabledRevision, reload, t]);

  const start = async () => {
    if (pending.current || !online || loading || !revision || !triggerId) return;
    let input;
    try {
      input = parseDrawerJson(inputJson);
    } catch {
      setError(t("autoPageDrawerInvalidJson", "Enter valid JSON with finite numbers before submitting."));
      return;
    }
    pending.current = true;
    setBusy(true);
    setError(null);
    const request = { taskId: task.id, triggerId, expectedRevision: revision.revision, input };
    try {
      const result = await call(environmentId, "automation.startRun", {
        ...request,
        requestId: requestId({ environmentId, ...request, attempt: attempt.current }),
      });
      if (result.outcome === "skipped" || !result.runId) {
        attempt.current += 1;
        const reasons = {
          lane_full: t(
            "autoPageDrawerRunLaneFull",
            "This task has reached its run limit. Wait for a run to finish, then try again.",
          ),
          task_disabled: t(
            "autoPageDrawerRunDisabled",
            "This task is disabled. Enable a revision before starting a run.",
          ),
          revision_mismatch: t(
            "autoPageDrawerRunRevisionChanged",
            "The enabled revision changed. Reload the task before starting a run.",
          ),
          invalid_input: t(
            "autoPageDrawerRunInputInvalid",
            "The input does not match this task's schema or cannot be used by its run settings.",
          ),
          trigger_missing: t(
            "autoPageDrawerRunTriggerMissing",
            "This trigger no longer exists in the enabled revision. Reload the task.",
          ),
        };
        setError(
          result.reason ? reasons[result.reason] : t("autoPageDrawerRunNotStarted", "The host did not start a run."),
        );
        return;
      }
      notify(
        result.outcome === "enqueued"
          ? t("autoPageDrawerRunQueued", "Run queued.")
          : t("autoPageDrawerRunStarted", "Run started."),
      );
      void refresh().catch((err: unknown) => notify(drawerError(err)));
      navigate({ view: "run", environmentId, taskId: task.id, runId: result.runId });
      onClose();
    } catch (err) {
      setError(drawerError(err));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  return (
    <SlideOverDrawer
      modal
      title={t("autoPageDrawerManualTitle", "Run task now")}
      onClose={() => {
        if (!pending.current) onClose();
      }}
      footer={
        <div className="auto-page-actions">
          <Button disabled={busy} onClick={onClose}>
            {t("autoPageDrawerCancel", "Cancel")}
          </Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={busy || loading || !online || !revision || !triggerId}
            onClick={() => void start()}
          >
            <AutomationIcon name="play" />
            {t("autoPageDrawerStartRun", "Start run")}
          </Button>
        </div>
      }
    >
      <div className="auto-page-drawer-stack">
        <HostChip environmentId={environmentId} />
        <h2 className="type-title-dialog">{task.name}</h2>
        <OfflineHostNotice environmentId={environmentId} />
        <p className="auto-page-muted type-body-relaxed">
          {t(
            "autoPageDrawerManualHelp",
            "Start the enabled revision once, with the input below. Scheduled and watched triggers are unchanged.",
          )}
        </p>
        {loading ? (
          <p role="status" className="auto-page-muted type-body-default">
            {t("autoPageDrawerLoadingRevision", "Loading enabled revision…")}
          </p>
        ) : task.enabledRevision === null ? (
          <p className="auto-page-warning type-body-default">
            {t("autoPageDrawerRunDisabled", "This task is disabled. Enable a revision before starting a run.")}
          </p>
        ) : (
          revision && (
            <>
              <p className="auto-page-muted type-mono-meta">
                {t("autoPageDrawerEnabledRevision", "Enabled revision {revision}").replace(
                  "{revision}",
                  String(revision.revision),
                )}
              </p>
              {manualTriggers.length ? (
                <Field label={t("autoPageDrawerManualTrigger", "Manual trigger")}>
                  <NativeSelect
                    value={triggerId}
                    disabled={busy}
                    onChange={(event) => setTriggerId(event.target.value)}
                  >
                    {manualTriggers.map((trigger) => (
                      <option key={trigger.id} value={trigger.id}>
                        {trigger.id}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              ) : (
                <p className="auto-page-warning type-body-default">
                  {t("autoPageDrawerNoManualTrigger", "The enabled revision has no manual trigger.")}
                </p>
              )}
              <DrawerSchemaInput
                key={`${revision.taskId}:${revision.revision}:${reload}`}
                schema={revision.source.inputSchema}
                value={inputJson}
                onChange={setInputJson}
                disabled={busy}
                label={t("autoPageDrawerRunInput", "Run input")}
              />
            </>
          )
        )}
        {error && (
          <p role="alert" className="auto-page-error type-body-default">
            {error}
          </p>
        )}
        {error && (
          <Button
            variant="ghost"
            disabled={busy || !online}
            onClick={() => {
              void refresh().catch((err: unknown) => setError(drawerError(err)));
              setReload((prior) => prior + 1);
            }}
          >
            {t("autoPageDrawerReloadTask", "Reload task")}
          </Button>
        )}
      </div>
    </SlideOverDrawer>
  );
}
