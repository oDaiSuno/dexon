import { useEffect, useState } from "react";
import type { TaskRevisionSummary } from "@shared/automation/views";
import { useI18n } from "@/i18n";
import { Badge, Button } from "@/components/form-controls";
import { EmptyState } from "./automation-atoms";
import { useAutomationWorkspace, type HostedTask } from "./automation-context";
import { formatDateTime } from "./automation-format";
import { AutomationIcon } from "./automation-icons";
import { RevisionSnapshotDialog } from "./RevisionSnapshotDialog";
import { taskError } from "./task-data";
import { TaskPermissionSummary } from "./task-flow";

export function TaskRevisions({ entry, online }: { entry: HostedTask; online: boolean }) {
  const { t } = useI18n();
  const { call, navigate, notify } = useAutomationWorkspace();
  const { environmentId, task } = entry;
  const { id: taskId, currentRevision, enabledRevision } = task;
  const key = JSON.stringify([environmentId, taskId, currentRevision, enabledRevision]);
  const [loaded, setLoaded] = useState<{
    key: string;
    revisions: readonly TaskRevisionSummary[];
    error: string | null;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  const [snapshot, setSnapshot] = useState<number | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);
  const data = loaded?.key === key ? loaded : null;

  useEffect(() => {
    if (!online) return;
    let active = true;
    void call(environmentId, "automation.listRevisions", { taskId }).then(
      (result) => {
        if (active) setLoaded({ key, revisions: result.revisions, error: null });
      },
      (error: unknown) => {
        if (active) setLoaded({ key, revisions: [], error: taskError(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [call, environmentId, taskId, key, online, retry]);

  const restore = async (revision: number) => {
    if (!online || restoring !== null) return;
    setRestoring(revision);
    try {
      const result = await call(environmentId, "automation.getTask", { taskId, revision });
      navigate({ view: "editor", environmentId, taskId, baseSpec: result.task.source });
    } catch (error) {
      notify(taskError(error));
    } finally {
      setRestoring(null);
    }
  };

  return (
    <section className="auto-page-stack" aria-label={t("autoPageTaskRevisionHistory", "Revision history")}>
      <div className="auto-page-section-heading">
        <h2 className="type-body-large-medium">{t("autoPageTaskRevisionHistory", "Revision history")}</h2>
        <Button
          disabled={!online}
          onClick={() => {
            setLoaded(null);
            setRetry((value) => value + 1);
          }}
        >
          {t("autoPageTaskRefreshRevisions", "Refresh revisions")}
        </Button>
      </div>
      <p className="type-body-default">
        {t(
          "autoPageTaskRestoreExplanation",
          "Restoring opens an older definition in the editor. Saving creates a new draft; it does not overwrite history or change existing runs.",
        )}
      </p>
      {!data && online && <EmptyState>{t("autoPageTaskLoadingRevisions", "Loading revisions…")}</EmptyState>}
      {!data && !online && (
        <EmptyState>
          {t("autoPageTaskRevisionsOffline", "Reconnect this host to load its revision history.")}
        </EmptyState>
      )}
      {data?.error && (
        <div className="auto-page-error type-body-default" role="alert">
          {data.error}
        </div>
      )}
      {data && !data.error && data.revisions.length === 0 && (
        <EmptyState>{t("autoPageTaskNoRevisions", "No revisions are available.")}</EmptyState>
      )}
      {data?.revisions
        .slice()
        .sort((left, right) => right.revision - left.revision)
        .map((revision) => {
          const current = revision.revision === currentRevision;
          const enabled = revision.revision === enabledRevision;
          return (
            <article key={revision.revision} className="auto-page-panel auto-page-stack">
              <div className="auto-page-revision-heading">
                <div className="auto-page-inline">
                  <h3 className="type-body-large-medium">v{revision.revision}</h3>
                  {current && (
                    <Badge tone={enabled ? "accent" : "warning"}>
                      {enabled
                        ? t("autoPageTaskCurrentRevision", "Current revision")
                        : t("autoPageTaskCurrentDraft", "Current draft")}
                    </Badge>
                  )}
                  {enabled && <Badge tone="success">{t("autoPageTaskRevisionEnabled", "Enabled")}</Badge>}
                  {revision.wasGranted && !enabled && (
                    <Badge>{t("autoPageTaskPreviouslyGranted", "Previously approved")}</Badge>
                  )}
                  {!current && !enabled && <Badge>{t("autoPageTaskHistoricalRevision", "Historical")}</Badge>}
                </div>
                <div className="auto-page-actions">
                  <Button disabled={!online} onClick={() => setSnapshot(revision.revision)}>
                    <AutomationIcon name="code" />
                    {t("autoPageTaskViewSnapshot", "View snapshot")}
                  </Button>
                  {!current && (
                    <Button
                      busy={restoring === revision.revision}
                      disabled={!online || restoring !== null}
                      onClick={() => void restore(revision.revision)}
                    >
                      {t("autoPageTaskRestoreRevision", "Restore as new revision")}
                    </Button>
                  )}
                </div>
              </div>
              <div className="auto-page-inline type-meta-default">
                <time dateTime={new Date(revision.createdAtMs).toISOString()}>
                  {formatDateTime(revision.createdAtMs)}
                </time>
                <span>
                  {t("autoPageTaskRevisionRuns", "Runs")}: {revision.runCount}
                </span>
              </div>
              <TaskPermissionSummary grant={revision.requiredGrant} />
              <span className="auto-page-hash type-mono-meta">{revision.planHash}</span>
            </article>
          );
        })}
      {snapshot !== null && (
        <RevisionSnapshotDialog
          environmentId={environmentId}
          taskId={taskId}
          revision={snapshot}
          onClose={() => setSnapshot(null)}
        />
      )}
    </section>
  );
}
