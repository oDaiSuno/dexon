import { useState } from "react";
import { useI18n } from "@/i18n";
import { Button, NativeSelect, TextInput } from "@/components/form-controls";
import { PageTopBar } from "@/components/page-top-bar";
import { requestAutomationAiSession } from "@/lib/automation-request";
import { EmptyState, HostChip, OfflineHostNotice, StatusPill } from "./automation-atoms";
import { useAutomationWorkspace } from "./automation-context";
import { AutomationIcon } from "./automation-icons";
import { createStarterTemplates } from "./automation-templates";
import { AutomationRunList } from "./AutomationRunList";
import { OverviewTaskTable } from "./overview-task-table";

export function AutomationOverview() {
  const { t } = useI18n();
  const { hosts, tasks, runs, inbox, loading, nativeConsentPending, navigate, openInbox, openVault, onClose } =
    useAutomationWorkspace();
  const [environmentId, setEnvironmentId] = useState("");
  const [cwd, setCwd] = useState("");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"tasks" | "runs">("tasks");
  const matchesHost = (id: string) => !environmentId || id === environmentId;
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
  const selectedEnvironment = environmentId || undefined;
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
  const selectEnvironment = (id: string) => {
    setEnvironmentId(id);
    setCwd("");
  };
  const remoteHosts = hosts.filter((host) => host.environment.id !== "primary");
  const localTaskCount = tasks.filter((entry) => entry.environmentId === "primary").length;
  const pendingToneFor = (id: string) => {
    const items = inbox.filter((entry) => entry.environmentId === id);
    if (items.some((entry) => entry.item.kind === "attention")) return "danger";
    if (items.length) return "warning";
    return undefined;
  };
  const hostDotTone = (status: string) => {
    if (status === "online") return "success";
    if (status === "connecting" || status === "backoff") return "warning";
    if (status === "blocked") return "danger";
    return "muted";
  };

  return (
    <section className="auto-page auto-page-overview">
      <PageTopBar
        parent={t("autoPageOverviewAutomation", "Automation")}
        current={t("autoPageOverviewTitle", "Overview")}
        isMobile={window.matchMedia("(max-width: 640px)").matches}
        onBack={onClose}
      />
      <div className="auto-page-scroll">
        <div className="auto-page-content auto-page-column">
          <header className="auto-page-header">
            <div className="auto-page-stack-tight">
              <h1 className="type-title-hero">{t("autoPageOverviewAutomation", "Automation")}</h1>
              <p className="type-body-default auto-page-secondary">
                {t("autoPageOverviewSubtitle", "Manage tasks, review decisions, and follow runs across your hosts.")}
              </p>
            </div>
            <div className="auto-page-actions">
              <Button disabled={Boolean(nativeConsentPending)} onClick={() => openVault(selectedEnvironment)}>
                <AutomationIcon name="key" size={14} />
                {t("autoPageOverviewVault", "Secret vault")}
              </Button>
              <Button disabled={Boolean(nativeConsentPending)} onClick={draftWithAi}>
                <AutomationIcon name="sparkles" size={14} />
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
                <AutomationIcon name="plus" size={14} />
                {t("autoPageOverviewNewTask", "New task")}
              </Button>
            </div>
          </header>
          <div className="auto-page-toolbar">
            <div
              className="auto-page-scope-bar"
              role="group"
              aria-label={t("autoPageOverviewHostFilter", "Filter by host")}
            >
              <Button variant="ghost" aria-pressed={!environmentId} onClick={() => selectEnvironment("")}>
                {t("autoPageOverviewAllShort", "All")}
                <span className="type-mono-meta auto-page-muted">{tasks.length}</span>
              </Button>
              <Button
                variant="ghost"
                aria-pressed={environmentId === "primary"}
                onClick={() => selectEnvironment("primary")}
              >
                <AutomationIcon name="laptop" size={12} />
                {t("autoPageOverviewLocal", "Local")}
                <span className="type-mono-meta auto-page-muted">{localTaskCount}</span>
                {pendingToneFor("primary") && (
                  <span className="auto-page-dot" data-tone={pendingToneFor("primary")} aria-hidden="true" />
                )}
              </Button>
              {remoteHosts.map((host) => {
                const pendingTone = pendingToneFor(host.environment.id);
                return (
                  <Button
                    key={host.environment.id}
                    variant="ghost"
                    aria-pressed={environmentId === host.environment.id}
                    onClick={() => selectEnvironment(host.environment.id)}
                  >
                    <span className="auto-page-dot" data-tone={hostDotTone(host.status)} aria-hidden="true" />
                    <span className="type-mono-label">{host.environment.label}</span>
                    {pendingTone && <span className="auto-page-dot" data-tone={pendingTone} aria-hidden="true" />}
                  </Button>
                );
              })}
            </div>
            <div className="auto-page-toolbar-filters">
              <NativeSelect
                aria-label={t("autoPageOverviewWorkingDirectory", "Working directory")}
                value={cwd}
                onChange={(event) => setCwd(event.target.value)}
              >
                <option value="">{t("autoPageOverviewAllDirectories", "All working directories")}</option>
                {directories.map((directory) => (
                  <option key={directory} value={directory}>
                    {directory}
                  </option>
                ))}
              </NativeSelect>
              <div className="auto-page-search-wrap">
                <AutomationIcon name="search" size={13} />
                <TextInput
                  aria-label={t("autoPageOverviewSearch", "Search")}
                  value={search}
                  onChange={setSearch}
                  placeholder={t("autoPageOverviewSearchPlaceholder", "Search tasks, paths, or runs")}
                />
              </div>
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
              <div className="auto-page-inline">
                <h2 className="type-heading">{t("autoPageOverviewInbox", "Needs your attention")}</h2>
                <span className="auto-page-count-pill type-mono-meta">{visibleInbox.length}</span>
                <span className="type-label-default auto-page-muted">
                  {t("autoPageOverviewInboxHint", "Aggregated across hosts; hides automatically once resolved")}
                </span>
              </div>
              <div className="auto-page-inbox-list">
                {visibleInbox.map((entry) => {
                  const isAttention = entry.item.kind === "attention";
                  return (
                    <div
                      className="auto-page-inbox-card"
                      data-tone={isAttention ? "danger" : "warning"}
                      key={`${entry.environmentId}:${entry.item.runId}:${entry.item.stepIndex}`}
                    >
                      <div className="auto-page-inbox-lead">
                        <span className="auto-page-inbox-icon" aria-hidden="true">
                          <AutomationIcon name={isAttention ? "alert" : "shield"} size={16} />
                        </span>
                        <div className="auto-page-stack-tight">
                          <div className="auto-page-inline">
                            <span className="type-body-medium">{entry.item.taskName || entry.item.taskId}</span>
                            <StatusPill
                              phase={isAttention ? "attention" : "waiting"}
                              waitKind={isAttention ? undefined : "approval"}
                            />
                            <HostChip environmentId={entry.environmentId} />
                          </div>
                          <span className="type-label-default auto-page-secondary">
                            {entry.item.kind === "approval" ? entry.item.title : entry.item.stepId}
                          </span>
                        </div>
                      </div>
                      <Button
                        variant={isAttention ? "danger" : "secondary"}
                        disabled={
                          Boolean(nativeConsentPending) ||
                          hosts.find((host) => host.environment.id === entry.environmentId)?.status !== "online"
                        }
                        onClick={() => openInbox(entry)}
                      >
                        {isAttention
                          ? t("autoPageOverviewVerifyCta", "Verify result")
                          : t("autoPageOverviewApproveCta", "Approve")}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
          {empty ? (
            <>
              <section className="auto-page-hero">
                <AutomationIcon name="sparkles" size={28} />
                <h2 className="type-title-section">
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
                    <AutomationIcon name="sparkles" size={14} />
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
                  <article className="auto-page-template" key={template.id}>
                    <span className="auto-page-task-icon" aria-hidden="true">
                      <AutomationIcon
                        name={
                          template.id === "endpoint-monitor"
                            ? "radio"
                            : template.id === "log-summary"
                              ? "code"
                              : "clock"
                        }
                        size={15}
                      />
                    </span>
                    <div className="auto-page-stack-tight">
                      <h3 className="type-body-large-medium">{template.name}</h3>
                      <p className="type-body-default auto-page-muted">{template.description}</p>
                    </div>
                    <Button
                      disabled={editorUnavailable}
                      onClick={() =>
                        navigate({ view: "editor", environmentId: editorEnvironment, baseSpec: template.spec })
                      }
                    >
                      {t("autoPageOverviewUseTemplate", "Use template")}
                      <AutomationIcon name="right" size={14} />
                    </Button>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <section className="auto-page-stack">
              <div className="auto-page-list-header">
                <div className="auto-page-list-title">
                  <h2 className="type-heading">
                    {tab === "tasks" ? t("autoPageOverviewTasks", "Tasks") : t("autoPageOverviewRunLog", "Run log")}
                  </h2>
                  <span className="type-mono-meta auto-page-muted">
                    {tab === "tasks" ? visibleTasks.length : visibleRuns.length}
                  </span>
                </div>
                <div
                  className="auto-page-segmented"
                  role="group"
                  aria-label={t("autoPageOverviewView", "Automation view")}
                >
                  <Button variant="ghost" aria-pressed={tab === "tasks"} onClick={() => setTab("tasks")}>
                    <AutomationIcon name="list" size={13} />
                    {t("autoPageOverviewTasks", "Tasks")}
                  </Button>
                  <Button variant="ghost" aria-pressed={tab === "runs"} onClick={() => setTab("runs")}>
                    <AutomationIcon name="history" size={13} />
                    {t("autoPageOverviewRunLog", "Run log")}
                  </Button>
                </div>
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
