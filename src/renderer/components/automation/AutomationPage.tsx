import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { useI18n } from "@/i18n";
import type { AutomationRouteTarget } from "@/lib/automation-request";
import { AutomationWorkspaceContext, type HostedInbox, type HostedTask } from "./automation-context";
import { useAutomationStore } from "./automation-store";
import { NativeConsentBanner } from "./automation-atoms";
import { AutomationOverview } from "./AutomationOverview";
import { AutomationTaskDetail } from "./AutomationTaskDetail";
import { AutomationRunDetail } from "./AutomationRunDetail";
import { AutomationTaskEditor } from "./AutomationTaskEditor";
import { InboxDrawer } from "./InboxDrawer";
import { SecretVaultDrawer } from "./SecretVaultDrawer";
import { ManualRunDialog } from "./ManualRunDialog";
import { Button } from "@/components/form-controls";

export interface AutomationPageProps {
  initialTarget?: AutomationRouteTarget | null;
  onConsumeTarget?: () => void;
  overviewResetKey?: number;
  onClose: () => void;
}
export function AutomationPage(props: AutomationPageProps): JSX.Element {
  const { initialTarget, onConsumeTarget, overviewResetKey = 0, onClose } = props;
  const { t } = useI18n();
  const store = useAutomationStore();
  const [target, setTarget] = useState<AutomationRouteTarget>(initialTarget ?? { view: "overview" });
  const [inbox, setInbox] = useState<HostedInbox | null>(null);
  const [vault, setVault] = useState<{ environmentId?: string; locked?: boolean } | null>(null);
  const [manualRun, setManualRun] = useState<HostedTask | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const pageRef = useRef<HTMLDivElement>(null);
  const editorLeaveGuard = useRef<((action: () => void) => void) | null>(null);
  const previousOverviewResetKey = useRef(overviewResetKey);
  const consumedTarget = useRef<AutomationRouteTarget | null>(null);
  const [savedEditorTask, setSavedEditorTask] = useState<Extract<AutomationRouteTarget, { view: "task" }> | null>(null);
  const registerEditorLeaveGuard = useCallback((guard: typeof editorLeaveGuard.current) => {
    editorLeaveGuard.current = guard;
  }, []);
  const rememberSavedEditorTask = useCallback((environmentId: string, taskId: string) => {
    setSavedEditorTask({ view: "task", environmentId, taskId });
  }, []);
  const startingRef = useRef(false);
  const startReceipts = useRef(new Map<string, string>());
  const navigate = useCallback((next: AutomationRouteTarget) => {
    setTarget(next);
    setInbox(null);
    setManualRun(null);
    setSavedEditorTask(null);
  }, []);
  const openVault = useCallback((environmentId?: string, locked?: boolean) => setVault({ environmentId, locked }), []);
  const openInbox = useCallback((entry: HostedInbox) => setInbox(entry), []);
  useEffect(() => {
    if (consumedTarget.current === initialTarget) return;
    consumedTarget.current = initialTarget ?? null;
    if (!initialTarget) return;
    navigate(initialTarget);
    onConsumeTarget?.();
  }, [initialTarget, navigate, onConsumeTarget]);
  useEffect(() => {
    if (previousOverviewResetKey.current === overviewResetKey) return;
    previousOverviewResetKey.current = overviewResetKey;
    const reset = () => {
      navigate({ view: "overview" });
      setVault(null);
    };
    if (editorLeaveGuard.current) editorLeaveGuard.current(reset);
    else reset();
  }, [overviewResetKey, navigate]);
  useEffect(() => {
    const page = pageRef.current;
    if (page && !page.contains(document.activeElement)) page.focus();
  }, []);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const page = pageRef.current;
      if (event.target !== document.body && !(event.target instanceof Node && page?.contains(event.target))) return;
      const overlays = document.querySelectorAll<HTMLElement>(
        'dialog[open], [role="dialog"], [role="menu"], [role="listbox"], [data-popover-open="true"]',
      );
      if ([...overlays].some((overlay) => overlay.getClientRects().length > 0)) return;
      event.preventDefault();
      if (vault) setVault(null);
      else if (inbox) return;
      else if (manualRun) setManualRun(null);
      else if (target.view === "editor")
        editorLeaveGuard.current?.(() =>
          navigate(
            savedEditorTask ??
              (target.taskId
                ? { view: "task", environmentId: target.environmentId, taskId: target.taskId }
                : { view: "overview" }),
          ),
        );
      else if (target.view === "run")
        navigate({ view: "task", environmentId: target.environmentId, taskId: target.taskId });
      else if (target.view !== "overview") navigate({ view: "overview" });
      else onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [target, vault, inbox, manualRun, savedEditorTask, navigate, onClose]);
  const startTask = (entry: HostedTask) => {
    if (startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    void (async () => {
      try {
        const revision = entry.task.enabledRevision;
        if (revision === null) {
          setNotice(t("autoPageEnableBeforeRun", "Enable a task revision before starting a run."));
          return;
        }
        const source =
          entry.revision?.revision === revision
            ? entry.revision
            : (await store.call(entry.environmentId, "automation.getTask", { taskId: entry.task.id, revision })).task;
        const triggers = source.source.triggers.filter((trigger) => trigger.kind === "manual");
        if (source.source.inputSchema || triggers.length > 1) {
          setManualRun({ ...entry, revision: source });
          return;
        }
        if (!triggers.length) {
          setNotice(t("autoPageNoManualTrigger", "Add a manual trigger to run this task on demand."));
          return;
        }
        const request = { taskId: entry.task.id, triggerId: triggers[0].id, expectedRevision: revision, input: null };
        const receiptKey = JSON.stringify([entry.environmentId, request]);
        const requestId = startReceipts.current.get(receiptKey) ?? crypto.randomUUID();
        startReceipts.current.set(receiptKey, requestId);
        const result = await store.call(entry.environmentId, "automation.startRun", { ...request, requestId });
        startReceipts.current.delete(receiptKey);
        if (result.runId)
          navigate({ view: "run", environmentId: entry.environmentId, taskId: entry.task.id, runId: result.runId });
        else setNotice(`${t("autoPageRunNotStarted", "The run was not started")}: ${result.reason ?? result.outcome}`);
        await store.refresh();
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error));
      } finally {
        startingRef.current = false;
        setStarting(false);
      }
    })();
  };
  const routeKey =
    target.view === "overview"
      ? "overview"
      : `${target.view}:${target.environmentId}:${target.taskId ?? "new"}${target.view === "run" ? `:${target.runId}` : ""}`;
  return (
    <AutomationWorkspaceContext.Provider
      value={{ ...store, navigate, openVault, openInbox, startTask, notify: setNotice, onClose }}
    >
      <div
        ref={pageRef}
        role="region"
        aria-label={t("autoPageTitle", "Automation tasks")}
        tabIndex={-1}
        className="automation-page-root"
        aria-busy={starting || undefined}
      >
        <NativeConsentBanner />
        {notice && (
          <div className="auto-page-toast type-body-default" role="status">
            <span>{notice}</span>
            <Button variant="ghost" onClick={() => setNotice(null)}>
              {t("autoPageDismiss", "Dismiss")}
            </Button>
          </div>
        )}
        {target.view === "overview" && <AutomationOverview />}
        {target.view === "task" && (
          <AutomationTaskDetail
            key={routeKey}
            environmentId={target.environmentId}
            taskId={target.taskId}
            tab={target.tab}
          />
        )}
        {target.view === "run" && (
          <AutomationRunDetail
            key={routeKey}
            environmentId={target.environmentId}
            taskId={target.taskId}
            runId={target.runId}
          />
        )}
        {target.view === "editor" && (
          <AutomationTaskEditor
            key={routeKey}
            environmentId={target.environmentId}
            taskId={target.taskId}
            baseSpec={target.baseSpec}
            onLeaveGuardChange={registerEditorLeaveGuard}
            onSavedTask={rememberSavedEditorTask}
          />
        )}
        {inbox && <InboxDrawer initialItem={inbox} onClose={() => setInbox(null)} />}
        {vault && (
          <SecretVaultDrawer
            {...vault}
            onClose={() => {
              setVault(null);
              void store.refresh();
            }}
          />
        )}
        {manualRun && <ManualRunDialog entry={manualRun} onClose={() => setManualRun(null)} />}
      </div>
    </AutomationWorkspaceContext.Provider>
  );
}
