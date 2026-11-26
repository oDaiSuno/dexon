import { useState } from "react";
import { useI18n } from "@/i18n";
import { Button, Field, NativeSelect, TextInput } from "@/components/form-controls";
import { PageTopBar } from "@/components/page-top-bar";
import { requestAutomationAiSession } from "@/lib/automation-request";
import { EmptyState, HostChip, OfflineHostNotice } from "./automation-atoms";
import { useAutomationWorkspace } from "./automation-context";
import { AutomationIcon } from "./automation-icons";
import { createStarterTemplates } from "./automation-templates";
import { AutomationRunList } from "./AutomationRunList";
import { OverviewTaskTable } from "./overview-task-table";

type HostFilter = "all" | "local" | "remotes";

export function AutomationOverview() {
  const { t } = useI18n();
  const { hosts, tasks, runs, inbox, loading, nativeConsentPending, navigate, openInbox, openVault, onClose } =
    useAutomationWorkspace();
  const [hostFilter, setHostFilter] = useState<HostFilter>("all");
  const [environmentId, setEnvironmentId] = useState("");
  const [cwd, setCwd] = useState("");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"tasks" | "runs">("tasks");
  const matchesHost = (id: string) =>
    (!environmentId || id === environmentId) &&
    (hostFilter === "all" || (hostFilter === "local" ? id === "primary" : id !== "primary"));
  const hostTasks = tasks.filter((entry) => matchesHost(entry.environmentId));
  const directories = [...new Set(hostTasks.map((entry) => entry.task.cwd).filter(Boolean))].sort();
  const query = search.trim().toLocaleLowerCase();
  const visibleTasks = hostTasks.filter(
    ({ task }) =>
      (!cwd || task.cwd === cwd) &&
      (!query || `${task.name} ${task.id} ${task.cwd}`.toLocaleLowerCase().includes(query)),
  );
  const visibleRuns = runs.filter((entry) => {
    if (!matchesHost(entry.environmentId)) return false;
    const task = tasks.find(
      (candidate) => candidate.environmentId === entry.environmentId && candidate.task.id === entry.run.taskId,
    );
    return (
      (!cwd || task?.task.cwd === cwd) &&
      (!query ||
        `${task?.task.name ?? ""} ${task?.task.cwd ?? ""} ${entry.run.taskId} ${entry.run.id}`
          .toLocaleLowerCase()
          .includes(query))
    );
  });
  const visibleInbox = inbox
    .filter((entry) => {
      if (!matchesHost(entry.environmentId)) return false;
      const task = tasks.find(
        (candidate) => candidate.environmentId === entry.environmentId && candidate.task.id === entry.item.taskId,
      );
      return (
        (!cwd || task?.task.cwd === cwd) &&
        (!query ||
          `${entry.item.taskName} ${entry.item.taskId} ${task?.task.cwd ?? ""}`.toLocaleLowerCase().includes(query))
      );
    })
    .slice()
    .sort((a, b) => Number(b.item.kind === "attention") - Number(a.item.kind === "attention"));
  const selectedEnvironment = environmentId || (hostFilter === "local" ? "primary" : undefined);
  const editorEnvironment = selectedEnvironment ?? "primary";
  const editorUnavailable =
    Boolean(nativeConsentPending) ||
    hosts.find((host) => host.environment.id === editorEnvironment)?.status !== "online";
  const empty =
    tasks.length === 0 &&
    !search &&
    !loading &&
    !hosts.some((host) => host.loading || host.error || host.status !== "online");
  const templates = createStarterTemplates(cwd);
  const draftWithAi = () => {
    requestAutomationAiSession({
      mode: "draft",
      ...(selectedEnvironment ? { environmentId: selectedEnvironment } : {}),
      ...(cwd ? { cwd } : {}),
    });
  };
  const selectGroup = (value: HostFilter) => {
    setHostFilter(value);
    setEnvironmentId("");
    setCwd("");
  };
  const groups: { value: HostFilter; label: string }[] = [
    { value: "all", label: t("autoPageOverviewAllHosts", "All hosts") },
    { value: "local", label: t("autoPageOverviewLocal", "Local") },
    { value: "remotes", label: t("autoPageOverviewRemotes", "Remotes") },
  ];
  return (
    <section className="auto-page auto-page-overview">
      <PageTopBar
        parent={t("autoPageOverviewAutomation", "Automation")}
        current={t("autoPageOverviewTitle", "Overview")}
        isMobile={window.matchMedia("(max-width: 640px)").matches}
        onBack={onClose}
      />
      <div className="auto-page-scroll">
        <div className="auto-page-content">
          <header className="auto-page-header">
            <div className="auto-page-stack-tight">
              <h1 className="type-title-large">{t("autoPageOverviewAutomation", "Automation")}</h1>
              <p className="type-body-default auto-page-muted">
                {t("autoPageOverviewSubtitle", "Manage tasks, review decisions, and follow runs across your hosts.")}
              </p>
            </div>
            <div className="auto-page-actions">
              <Button disabled={Boolean(nativeConsentPending)} onClick={() => openVault(selectedEnvironment)}>
                <AutomationIcon name="key" />
                {t("autoPageOverviewVault", "Secret vault")}
              </Button>
              <Button disabled={Boolean(nativeConsentPending)} onClick={draftWithAi}>
                <AutomationIcon name="sparkles" />
                {t("autoPageOverviewAiDraft", "Draft with AI")}
              </Button>
              <Button
                variant="primary"
                disabled={editorUnavailable}
                onClick={() =>
                  navigate({
                    view: "editor",
                    environmentId: editorEnvironment,
                    ...(cwd
                      ? {
                          baseSpec: {
                            ...templates[0].spec,
                            id: "new-task",
                            name: t("autoPageOverviewNewTask", "New task"),
                            triggers: [{ id: "manual", kind: "manual" }],
                          },
                        }
                      : {}),
                  })
                }
              >
                <AutomationIcon name="plus" />
                {t("autoPageOverviewNewTask", "New task")}
              </Button>
            </div>
          </header>
          <div className="auto-page-stack">
            <div
              className="auto-page-filter-pills"
              role="group"
              aria-label={t("autoPageOverviewHostFilter", "Filter by host")}
            >
              {groups.map((group) => {
                const accepts = (id: string) =>
                  group.value === "all" || (group.value === "local" ? id === "primary" : id !== "primary");
                const items = inbox.filter((entry) => accepts(entry.environmentId));
                const tone = items.some((entry) => entry.item.kind === "attention")
                  ? "danger"
                  : items.length
                    ? "warning"
                    : undefined;
                return (
                  <Button
                    key={group.value}
                    variant="ghost"
                    aria-pressed={hostFilter === group.value && !environmentId}
                    onClick={() => selectGroup(group.value)}
                  >
                    {tone && (
                      <span
                        className="auto-page-dot"
                        data-tone={tone}
                        aria-label={
                          tone === "danger"
                            ? t("autoPageOverviewAttention", "Result needs review")
                            : t("autoPageOverviewApproval", "Approval required")
                        }
                      />
                    )}
                    {group.label}
                    <span className="type-meta-default">
                      {tasks.filter((entry) => accepts(entry.environmentId)).length}
                    </span>
                  </Button>
                );
              })}
            </div>
            <div className="auto-page-toolbar">
              <Field label={t("autoPageOverviewHost", "Host")}>
                <NativeSelect
                  value={environmentId}
                  onChange={(event) => {
                    setEnvironmentId(event.target.value);
                    setCwd("");
                  }}
                >
                  <option value="">{t("autoPageOverviewGroupHosts", "All hosts in group")}</option>
                  {hosts
                    .filter(
                      (host) =>
                        hostFilter === "all" ||
                        (hostFilter === "local"
                          ? host.environment.id === "primary"
                          : host.environment.id !== "primary"),
                    )
                    .map((host) => (
                      <option key={host.environment.id} value={host.environment.id}>
                        {host.environment.id === "primary"
                          ? t("autoPageOverviewLocal", "Local")
                          : host.environment.label}
                      </option>
                    ))}
                </NativeSelect>
              </Field>
              <Field label={t("autoPageOverviewWorkingDirectory", "Working directory")}>
                <NativeSelect value={cwd} onChange={(event) => setCwd(event.target.value)}>
                  <option value="">{t("autoPageOverviewAllDirectories", "All working directories")}</option>
                  {directories.map((directory) => (
                    <option key={directory} value={directory}>
                      {directory}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label={t("autoPageOverviewSearch", "Search")}>
                <TextInput
                  value={search}
                  onChange={setSearch}
                  placeholder={t("autoPageOverviewSearchPlaceholder", "Search tasks, paths, or runs")}
                />
              </Field>
            </div>
          </div>
          {hosts
            .filter((host) => matchesHost(host.environment.id) && (host.status !== "online" || host.error))
            .map((host) => (
              <OfflineHostNotice key={host.environment.id} environmentId={host.environment.id} />
            ))}
          {loading && (
            <div role="status" className="type-body-default auto-page-muted">
              {t("autoPageOverviewLoading", "Loading automation…")}
            </div>
          )}
          {visibleInbox.length > 0 && (
            <section className="auto-page-stack" aria-label={t("autoPageOverviewInbox", "Needs your attention")}>
              <h2 className="type-title-small">
                {t("autoPageOverviewInbox", "Needs your attention")} · {visibleInbox.length}
              </h2>
              {visibleInbox.map((entry) => (
                <div
                  className="auto-page-inbox-card"
                  data-tone={entry.item.kind === "attention" ? "danger" : "warning"}
                  key={`${entry.environmentId}:${entry.item.runId}:${entry.item.stepIndex}`}
                >
                  <AutomationIcon name={entry.item.kind === "attention" ? "alert" : "key"} />
                  <div className="auto-page-stack-tight">
                    <span className="type-body-medium">
                      {entry.item.kind === "attention"
                        ? t("autoPageOverviewAttention", "Result needs review")
                        : t("autoPageOverviewApproval", "Approval required")}
                    </span>
                    <span className="type-body-default">
                      {entry.item.taskName || entry.item.taskId} ·{" "}
                      {entry.item.kind === "approval" ? entry.item.title : entry.item.stepId}
                    </span>
                    <HostChip environmentId={entry.environmentId} />
                  </div>
                  <Button
                    disabled={
                      Boolean(nativeConsentPending) ||
                      hosts.find((host) => host.environment.id === entry.environmentId)?.status !== "online"
                    }
                    onClick={() => openInbox(entry)}
                  >
                    {t("autoPageOverviewReview", "Review")}
                  </Button>
                </div>
              ))}
            </section>
          )}
          {empty ? (
            <>
              <section className="auto-page-hero auto-page-stack">
                <AutomationIcon name="sparkles" size={32} />
                <h2 className="type-title-large">
                  {t("autoPageOverviewHeroTitle", "Put recurring work on autopilot")}
                </h2>
                <p className="type-body-default auto-page-muted">
                  {t(
                    "autoPageOverviewHeroDescription",
                    "Describe what you need, or build a task yourself. Review permissions before enabling it.",
                  )}
                </p>
                <div className="auto-page-actions">
                  <Button variant="primary" disabled={Boolean(nativeConsentPending)} onClick={draftWithAi}>
                    <AutomationIcon name="sparkles" />
                    {t("autoPageOverviewAiDraft", "Draft with AI")}
                  </Button>
                  <Button
                    disabled={editorUnavailable}
                    onClick={() => navigate({ view: "editor", environmentId: editorEnvironment })}
                  >
                    {t("autoPageOverviewBuildManually", "Build manually")}
                  </Button>
                </div>
              </section>
              <div className="auto-page-template-grid">
                {templates.map((template) => (
                  <article className="auto-page-template auto-page-stack" key={template.id}>
                    <AutomationIcon
                      name={
                        template.id === "endpoint-monitor" ? "server" : template.id === "log-summary" ? "code" : "clock"
                      }
                    />
                    <h3 className="type-body-large-medium">{template.name}</h3>
                    <p className="type-body-default auto-page-muted">{template.description}</p>
                    <Button
                      disabled={editorUnavailable}
                      onClick={() =>
                        navigate({ view: "editor", environmentId: editorEnvironment, baseSpec: template.spec })
                      }
                    >
                      {t("autoPageOverviewUseTemplate", "Use template")}
                      <AutomationIcon name="right" />
                    </Button>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <section className="auto-page-stack">
              <div className="auto-page-tabs" role="group" aria-label={t("autoPageOverviewView", "Automation view")}>
                <Button variant="ghost" aria-pressed={tab === "tasks"} onClick={() => setTab("tasks")}>
                  {t("autoPageOverviewTasks", "Tasks")} · {visibleTasks.length}
                </Button>
                <Button variant="ghost" aria-pressed={tab === "runs"} onClick={() => setTab("runs")}>
                  {t("autoPageOverviewRunLog", "Run log")} · {visibleRuns.length}
                </Button>
              </div>
              {tab === "runs" ? (
                <AutomationRunList runs={visibleRuns} completed />
              ) : visibleTasks.length ? (
                <OverviewTaskTable tasks={visibleTasks} />
              ) : (
                <EmptyState>{t("autoPageOverviewNoTasks", "No tasks match these filters.")}</EmptyState>
              )}
            </section>
          )}
        </div>
      </div>
    </section>
  );
}
