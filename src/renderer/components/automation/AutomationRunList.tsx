import { useState } from "react";
import { useI18n } from "@/i18n";
import { Button } from "@/components/form-controls";
import { EmptyState, HostChip, PhaseFilters, StatusPill } from "./automation-atoms";
import { useAutomationWorkspace, type HostedRun } from "./automation-context";
import { formatDateTime, formatDuration, formatRelativeTime, matchesPhaseFilter } from "./automation-format";
import { AutomationIcon } from "./automation-icons";

export function AutomationRunList({
  runs,
  completed = false,
  showHost = true,
}: {
  runs: readonly HostedRun[];
  completed?: boolean;
  showHost?: boolean;
}) {
  const { t } = useI18n();
  const { tasks, inbox, navigate, openInbox, hosts, nativeConsentPending } = useAutomationWorkspace();
  const [filter, setFilter] = useState("all");
  const reviewFor = ({ environmentId, run }: HostedRun) =>
    inbox.find(
      (entry) =>
        entry.environmentId === environmentId && entry.item.runId === run.id && entry.item.kind === "attention",
    ) ?? inbox.find((entry) => entry.environmentId === environmentId && entry.item.runId === run.id);
  const pendingCount = runs.filter((entry) => Boolean(reviewFor(entry))).length;
  const visible = runs
    .filter((entry) => (filter === "pending" ? Boolean(reviewFor(entry)) : matchesPhaseFilter(entry.run.phase, filter)))
    .slice()
    .sort((a, b) => b.run.createdAtMs - a.run.createdAtMs);

  return (
    <div className="auto-page-stack">
      <PhaseFilters
        value={filter}
        onChange={setFilter}
        completed={completed}
        pendingCount={pendingCount}
        trailing={
          <span className="type-meta-default auto-page-muted">{t("autoPageOverviewSortDesc", "Newest first")}</span>
        }
      />
      {visible.length === 0 ? (
        <EmptyState>{t("autoPageOverviewNoRuns", "No runs match this view.")}</EmptyState>
      ) : (
        <div className="auto-page-table-scroll">
          <table className="auto-page-table auto-page-run-table">
            <thead>
              <tr className="type-meta-caps">
                <th scope="col">{t("autoPageOverviewStatus", "Status")}</th>
                <th scope="col">{t("autoPageOverviewTaskRun", "Task / run")}</th>
                {showHost && <th scope="col">{t("autoPageOverviewHost", "Host")}</th>}
                <th scope="col">{t("autoPageOverviewStarted", "Created")}</th>
                <th scope="col">{t("autoPageOverviewActions", "Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((entry) => {
                const { environmentId, run } = entry;
                const task = tasks.find(
                  (candidate) => candidate.environmentId === environmentId && candidate.task.id === run.taskId,
                );
                const review = reviewFor(entry);
                const unavailable =
                  nativeConsentPending !== null ||
                  hosts.find((host) => host.environment.id === environmentId)?.status !== "online";
                const isAttention = review?.item.kind === "attention";
                return (
                  <tr
                    key={`${environmentId}:${run.id}`}
                    onClick={() => navigate({ view: "run", environmentId, taskId: run.taskId, runId: run.id })}
                  >
                    <td>
                      <StatusPill
                        phase={run.phase}
                        waitKind={review?.item.kind === "approval" ? "approval" : undefined}
                      />
                    </td>
                    <td>
                      <div className="auto-page-stack-tight">
                        <div className="auto-page-inline">
                          <Button
                            variant="ghost"
                            className="auto-page-text-button type-mono-label-strong"
                            onClick={(event) => {
                              event.stopPropagation();
                              navigate({ view: "run", environmentId, taskId: run.taskId, runId: run.id });
                            }}
                          >
                            {showHost ? `${task?.task.name || run.taskId} · ${run.id}` : run.id}
                          </Button>
                          <span className="type-label-default auto-page-secondary">v{run.revision}</span>
                        </div>
                        {review && (
                          <span
                            className={`type-label-default ${isAttention ? "auto-page-error" : "auto-page-warning"}`}
                          >
                            {review.item.kind === "approval" ? review.item.title : review.item.stepId}
                          </span>
                        )}
                      </div>
                    </td>
                    {showHost && (
                      <td>
                        <HostChip environmentId={environmentId} />
                      </td>
                    )}
                    <td className="type-mono-meta auto-page-muted">
                      <time dateTime={new Date(run.createdAtMs).toISOString()} title={formatDateTime(run.createdAtMs)}>
                        {formatRelativeTime(run.createdAtMs)}
                      </time>
                      {" · "}
                      {formatDuration(run.admittedAtMs, run.endedAtMs)}
                    </td>
                    <td>
                      <div className="auto-page-row">
                        {review ? (
                          <Button
                            variant={isAttention ? "danger" : "secondary"}
                            disabled={unavailable}
                            onClick={(event) => {
                              event.stopPropagation();
                              openInbox(review);
                            }}
                          >
                            {isAttention
                              ? t("autoPageOverviewVerifyCta", "Verify result")
                              : t("autoPageOverviewApproveCta", "Approve")}
                          </Button>
                        ) : (
                          <span className="auto-page-muted" aria-hidden="true">
                            <AutomationIcon name="right" size={14} />
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
