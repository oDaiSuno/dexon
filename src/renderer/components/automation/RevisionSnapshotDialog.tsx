import { useEffect, useState } from "react";
import type { TaskRevisionView } from "@shared/automation/views";
import { useI18n } from "@/i18n";
import { Button } from "@/components/form-controls";
import { useAutomationWorkspace } from "./automation-context";
import { HostChip, JsonBlock, OfflineHostNotice } from "./automation-atoms";
import { formatDateTime } from "./automation-format";
import { SlideOverDrawer } from "./SlideOverDrawer";
import { drawerError } from "./drawer-utils";

export function RevisionSnapshotDialog({
  environmentId,
  taskId,
  revision,
  onClose,
}: {
  environmentId: string;
  taskId: string;
  revision: number;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { hosts, call } = useAutomationWorkspace();
  const [snapshot, setSnapshot] = useState<TaskRevisionView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const online = hosts.some((host) => host.environment.id === environmentId && host.status === "online");

  useEffect(() => {
    let active = true;
    setSnapshot(null);
    setError(null);
    setLoading(false);
    if (!online) return;
    setLoading(true);
    void call(environmentId, "automation.getTask", { taskId, revision })
      .then(({ task }) => {
        if (active) setSnapshot(task);
      })
      .catch((err: unknown) => {
        if (active) setError(drawerError(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [call, environmentId, taskId, revision, online, reload]);

  return (
    <SlideOverDrawer
      modal
      title={t("autoPageDrawerSnapshotTitle", "Revision {revision} snapshot").replace("{revision}", String(revision))}
      onClose={onClose}
      footer={<Button onClick={onClose}>{t("autoPageDrawerCloseSnapshot", "Close snapshot")}</Button>}
    >
      <div className="auto-page-drawer-stack">
        <HostChip environmentId={environmentId} />
        <OfflineHostNotice environmentId={environmentId} />
        <p className="auto-page-muted type-body-relaxed">
          {t(
            "autoPageDrawerSnapshotHelp",
            "This is a read-only saved revision. Viewing it does not enable, restore or modify the task.",
          )}
        </p>
        {loading && (
          <p role="status" className="auto-page-muted type-body-default">
            {t("autoPageDrawerLoadingSnapshot", "Loading revision snapshot…")}
          </p>
        )}
        {error && (
          <>
            <p role="alert" className="auto-page-error type-body-default">
              {error}
            </p>
            <Button disabled={!online || loading} onClick={() => setReload((prior) => prior + 1)}>
              {t("autoPageDrawerRetryLoad", "Try again")}
            </Button>
          </>
        )}
        {snapshot && (
          <>
            <h2 className="type-title-dialog">{snapshot.source.name}</h2>
            <p className="auto-page-muted type-label-default">
              {t("autoPageDrawerSnapshotSavedAt", "Saved {time}").replace(
                "{time}",
                formatDateTime(snapshot.createdAtMs),
              )}
            </p>
            <div className="auto-page-snapshot-hash">
              <span className="auto-page-muted type-label-default">
                {t("autoPageDrawerSnapshotPlanHash", "Definition fingerprint")}
              </span>
              <span className="type-mono-label">{snapshot.planHash}</span>
            </div>
            <section className="auto-page-snapshot-source">
              <h3 className="type-heading">{t("autoPageDrawerSnapshotDefinition", "Task definition")}</h3>
              <JsonBlock value={snapshot.source} />
            </section>
            <details className="auto-page-schema-details">
              <summary className="type-label-medium">
                {t("autoPageDrawerSnapshotPermissions", "Required permissions")}
              </summary>
              <JsonBlock value={snapshot.requiredGrant} />
            </details>
            <details className="auto-page-schema-details">
              <summary className="type-label-medium">{t("autoPageDrawerSnapshotGrant", "Saved authorization")}</summary>
              <JsonBlock value={snapshot.grant} />
            </details>
          </>
        )}
      </div>
    </SlideOverDrawer>
  );
}
