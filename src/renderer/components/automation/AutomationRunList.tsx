import { useState } from "react";
import { useI18n } from "@/i18n";
import { Button } from "@/components/form-controls";
import { EmptyState, HostChip, PhaseFilters, StatusPill } from "./automation-atoms";
import { useAutomationWorkspace, type HostedRun } from "./automation-context";
import { formatDateTime, formatDuration, formatRelativeTime, matchesPhaseFilter } from "./automation-format";

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
  const visible = runs
    .filter((entry) => (filter === "pending" ? Boolean(reviewFor(entry)) : matchesPhaseFilter(entry.run.phase, filter)))
    .slice()
    .sort((a, b) => b.run.createdAtMs - a.run.createdAtMs);

  return (
    <div className="auto-page-stack">
      <PhaseFilters value={filter} onChange={setFilter} completed={completed} />
      {visible.length === 0 ? (
        <EmptyState>{t("autoPageOverviewNoRuns", "No runs match this view.")}</EmptyState>
      ) : (
        <div className="auto-page-table-scroll">
          <table className="auto-page-table auto-page-run-table">
            <thead>
              <tr className="type-label-default">
                <th scope="col">{t("autoPageOverviewStatus", "Status")}</th>
                <th scope="col">{t("autoPageOverviewTaskRun", "Task / run")}</th>
                {showHost && <th scope="col">{t("autoPageOverviewHost", "Host")}</th>}
                <th scope="col">{t("autoPageOverviewStarted", "Created")}</th>
                <th scope="col">{t("autoPageOverviewDuration", "Duration")}</th>
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
                return (
                  <tr key={`${environmentId}:${run.id}`}>
                    <td>
                      <StatusPill
                        phase={run.phase}
                        waitKind={review?.item.kind === "approval" ? "approval" : undefined}
                      />
                    </td>
                    <td>
                      <div className="auto-page-stack-tight">
                        <Button
                          variant="ghost"
                          className="auto-page-text-button"
                          onClick={() => navigate({ view: "run", environmentId, taskId: run.taskId, runId: run.id })}
                        >
                          {task?.task.name || run.taskId}
                        </Button>
                        <span className="type-meta-default auto-page-muted">
                          v{run.revision} · {run.id}
                        </span>
                      </div>
                    </td>
                    {showHost && (
                      <td>
                        <HostChip environmentId={environmentId} />
                      </td>
                    )}
                    <td className="type-meta-default">
                      <time dateTime={new Date(run.createdAtMs).toISOString()} title={formatDateTime(run.createdAtMs)}>
                        {formatRelativeTime(run.createdAtMs)}
                      </time>
                    </td>
                    <td className="type-mono-meta">{formatDuration(run.admittedAtMs, run.endedAtMs)}</td>
                    <td>
                      {review && (
                        <Button variant="ghost" disabled={unavailable} onClick={() => openInbox(review)}>
                          {t("autoPageOverviewReview", "Review")}
                        </Button>
                      )}
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
