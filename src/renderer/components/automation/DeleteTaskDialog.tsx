import { useRef, useState } from "react";
import { useI18n } from "@/i18n";
import { Button, Field, TextInput } from "@/components/form-controls";
import { useAutomationWorkspace, type HostedTask } from "./automation-context";
import { HostChip, OfflineHostNotice } from "./automation-atoms";
import { isActivePhase } from "./automation-format";
import { AutomationIcon } from "./automation-icons";
import { SlideOverDrawer } from "./SlideOverDrawer";
import { drawerError } from "./drawer-utils";

export function DeleteTaskDialog({
  entry,
  onClose,
  onDeleted,
}: {
  entry: HostedTask;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { t } = useI18n();
  const { hosts, runs, call, refresh, notify } = useAutomationWorkspace();
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const online = hosts.some((host) => host.environment.id === entry.environmentId && host.status === "online");
  const activeRuns = runs.filter(
    (entryRun) =>
      entryRun.environmentId === entry.environmentId &&
      entryRun.run.taskId === entry.task.id &&
      isActivePhase(entryRun.run.phase),
  );
  const disabled = busy || !online || confirmation !== entry.task.name || activeRuns.length > 0;

  const remove = async () => {
    if (pending.current || disabled) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await call(entry.environmentId, "automation.deleteTask", { taskId: entry.task.id });
      notify(t("autoPageDrawerTaskDeleted", "Task deleted permanently."));
      void refresh().catch((err: unknown) => notify(drawerError(err)));
      onDeleted();
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
      title={t("autoPageDrawerDeleteTaskTitle", "Delete task permanently?")}
      onClose={() => {
        if (!pending.current) onClose();
      }}
      footer={
        <div className="auto-page-actions">
          <Button disabled={busy} onClick={onClose}>
            {t("autoPageDrawerCancel", "Cancel")}
          </Button>
          <Button variant="danger" busy={busy} disabled={disabled} onClick={() => void remove()}>
            <AutomationIcon name="trash" />
            {t("autoPageDrawerDeleteTaskConfirm", "Delete permanently")}
          </Button>
        </div>
      }
    >
      <div className="auto-page-drawer-stack">
        <HostChip environmentId={entry.environmentId} />
        <h2 className="type-title-dialog">{entry.task.name}</h2>
        <OfflineHostNotice environmentId={entry.environmentId} />
        <p className="auto-page-warning type-body-relaxed">
          {t(
            "autoPageDrawerDeleteTaskWarning",
            "This cannot be undone. The task and all of its saved revisions, run history, pending inbox items and automation sessions will be removed. Its triggers will stop.",
          )}
        </p>
        <section className="auto-page-delete-scope">
          <h3 className="type-heading">{t("autoPageDrawerDeleteFilesTitle", "What happens to files and secrets")}</h3>
          <p className="auto-page-muted type-body-relaxed">
            {t(
              "autoPageDrawerDeleteManagedScope",
              "A task working folder is deleted only when the host verifies that it is a strict subfolder of ~/.dexon/automations. The managed root and folders outside it are kept.",
            )}
          </p>
          <p className="auto-page-muted type-body-relaxed">
            {t(
              "autoPageDrawerDeletePreservedScope",
              "External project files and shared secret values are not deleted. This action affects only this task on the selected host.",
            )}
          </p>
          <p className="auto-page-path type-mono-label">{entry.task.cwd}</p>
        </section>
        {activeRuns.length > 0 && (
          <p role="alert" className="auto-page-warning type-body-default">
            {t(
              "autoPageDrawerDeleteActiveRuns",
              "This task still has active runs. Cancel or finish them before deleting the task.",
            )}
          </p>
        )}
        <fieldset className="auto-page-fieldset" disabled={busy || !online}>
          <Field label={t("autoPageDrawerTypeTaskName", "Type the task name to confirm")}>
            <TextInput value={confirmation} onChange={setConfirmation} placeholder={entry.task.name} />
          </Field>
        </fieldset>
        {error && (
          <p role="alert" className="auto-page-error type-body-default">
            {error}
          </p>
        )}
      </div>
    </SlideOverDrawer>
  );
}
