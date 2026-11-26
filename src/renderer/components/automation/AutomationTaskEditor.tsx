import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import type { TaskSpec } from "@shared/automation/spec";
import { useI18n } from "@/i18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { requestAutomationAiSession } from "@/lib/automation-request";
import { Badge, Button, Field, NativeSelect, TextInput } from "../form-controls";
import { PageTopBar } from "../page-top-bar";
import { HostChip, OfflineHostNotice } from "./automation-atoms";
import { useAutomationWorkspace } from "./automation-context";
import { AutomationIcon } from "./automation-icons";
import { AutomationTriggerInspector } from "./AutomationTriggerInspector";
import { AutomationStepInspector } from "./AutomationStepInspector";
import { AutomationPermissionsPanel } from "./AutomationPermissionsPanel";
import { EditorValidityContext, EditorVariablesContext } from "./editor-controls";
import { EditorStepFlow } from "./editor-flow";
import { EditorTaskSettings } from "./editor-task-settings";
import { useEditorDraft } from "./editor-use-draft";
import { editorError, editorNewStep, editorTaskDirectory, editorUniqueId, type EditorStepKind } from "./editor-model";

export interface AutomationTaskEditorProps {
  environmentId: string;
  taskId?: string;
  baseSpec?: TaskSpec;
  onLeaveGuardChange?: (guard: ((action: () => void) => void) | null) => void;
  onSavedTask?: (environmentId: string, taskId: string) => void;
}
export function AutomationTaskEditor(props: AutomationTaskEditorProps) {
  const { environmentId, taskId, baseSpec, onLeaveGuardChange, onSavedTask } = props;
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const editor = useEditorDraft(environmentId, taskId, baseSpec);
  const { hosts, navigate, notify } = useAutomationWorkspace();
  const { draft, updateDraft } = editor;
  const [mode, setMode] = useState<"visual" | "raw">("visual");
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [panel, setPanel] = useState<"settings" | "permissions">("settings");
  const selectedIndex = draft.steps.findIndex((step) => step.id === selectedId);
  const selectedStep = selectedIndex < 0 ? undefined : draft.steps[selectedIndex];
  const host = hosts.find((entry) => entry.environment.id === editor.environmentId);
  const currentSpec = mode === "raw" ? (editor.rawSpec ?? draft) : draft;
  const guardedLeave = useCallback(
    (action: () => void) => {
      if (editor.busy) return;
      if (
        !editor.dirty ||
        window.confirm(t("autoPageEditorDiscardConfirm", "Leave this editor and discard unsaved changes?"))
      )
        action();
    },
    [editor.busy, editor.dirty, t],
  );
  useLayoutEffect(() => {
    onLeaveGuardChange?.(guardedLeave);
    return () => onLeaveGuardChange?.(null);
  }, [guardedLeave, onLeaveGuardChange]);
  useEffect(() => {
    if (editor.savedTaskId) onSavedTask?.(editor.environmentId, editor.savedTaskId);
  }, [editor.environmentId, editor.savedTaskId, onSavedTask]);
  const backToTask = () =>
    guardedLeave(() =>
      navigate(
        editor.savedTaskId
          ? { view: "task", environmentId: editor.environmentId, taskId: editor.savedTaskId }
          : { view: "overview" },
      ),
    );
  const select = (id?: string) => {
    if (editor.invalidFields.length) {
      notify(t("autoPageEditorFixLocalFields", "Finish or clear invalid fields before selecting another step."));
      return;
    }
    if (mode === "raw" && !switchMode("visual")) return;
    setSelectedId(id);
    setPanel("settings");
  };
  const insert = (index: number, kind: EditorStepKind) => {
    if (editor.invalidFields.length) return;
    const step = editorNewStep(kind, editorUniqueId("step", draft.steps));
    updateDraft({ ...draft, steps: [...draft.steps.slice(0, index), step, ...draft.steps.slice(index)] });
    setSelectedId(step.id);
    setPanel("settings");
  };
  const switchMode = (next: "visual" | "raw") => {
    if (next === mode) return;
    if (editor.invalidFields.length) {
      notify(t("autoPageEditorFixLocalFields", "Finish or clear invalid fields before selecting another step."));
      return;
    }
    if (next === "visual") {
      if (!editor.rawSpec) {
        notify(t("autoPageEditorFixRawFirst", "Fix the raw configuration before switching to visual editing."));
        return;
      }
      updateDraft(editor.rawSpec);
    }
    setMode(next);
    return true;
  };
  const adjustWithAi = () => {
    requestAutomationAiSession({
      mode: "adjust",
      environmentId: editor.environmentId,
      cwd: currentSpec.cwd,
      taskId: editor.savedTaskId,
      taskName: currentSpec.name,
      revision: editor.revision,
      environmentLabel: host?.environment.label ?? editor.environmentId,
      hasUnsavedChanges: editor.dirty,
      draftSpec: currentSpec,
      missingSecrets: editor.missingSecrets,
    });
  };
  const status = (() => {
    if (editor.loading) return t("autoPageEditorLoading", "Loading task…");
    if (editor.busy) return t("autoPageEditorSaving", "Saving or awaiting desktop authorization…");
    if (!editor.hostOnline) return t("autoPageEditorOfflineSave", "Connect to the target host to validate and save.");
    if (editor.invalidFields.length)
      return t("autoPageEditorLocalInvalid", "Some fields contain unfinished or invalid values.");
    if (editor.idChanged) return t("autoPageEditorIdLocked", "An existing task ID cannot be changed.");
    if (editor.idInvalid)
      return t("autoPageEditorIdHint", "Use a stable lowercase ID with letters, digits and hyphens.");
    if (editor.collision)
      return t("autoPageEditorIdCollision", "This task ID already exists on this host. Choose a different ID.");
    if (editor.validating || !editor.validation) return t("autoPageEditorValidating", "Validating draft…");
    if (!editor.validation.valid) return t("autoPageEditorInvalid", "Fix validation issues before saving.");
    if (editor.missingSecrets.length)
      return t(
        "autoPageEditorMissingSecretsFooter",
        "Draft is valid, but referenced secrets are missing or unchecked. You may save, but cannot enable yet.",
      );
    return t("autoPageEditorValid", "Draft validation passed");
  })();
  return (
    <EditorValidityContext.Provider value={editor.markInvalid}>
      <EditorVariablesContext.Provider value={draft.steps.slice(0, Math.max(0, selectedIndex))}>
        <div
          className="auto-page-editor"
          onFocusCapture={(event) => {
            if (
              !event.relatedTarget ||
              !(event.relatedTarget instanceof Node) ||
              !event.currentTarget.contains(event.relatedTarget)
            )
              void editor.refreshSecrets();
          }}
        >
          <PageTopBar
            parent={t("autoPageEditorAutomation", "Automation tasks")}
            current={
              editor.savedTaskId
                ? `${draft.name} · ${t("autoPageEditorEditFlow", "Edit flow")}`
                : t("autoPageEditorNewTask", "New task")
            }
            isMobile={isMobile}
            onParent={() => guardedLeave(() => navigate({ view: "overview" }))}
            onBack={backToTask}
          />
          <div className="auto-page-editor-body">
            <OfflineHostNotice environmentId={editor.environmentId} />
            <header className="auto-page-editor-header">
              <fieldset
                className="auto-page-editor-title-fields"
                disabled={editor.busy || editor.loading || editor.loadFailed || mode === "raw"}
              >
                <Field label={t("autoPageEditorTaskName", "Task title")}>
                  <TextInput value={draft.name} onChange={(name) => updateDraft({ ...draft, name })} />
                </Field>
                {!editor.savedTaskId ? (
                  <Field label={t("autoPageEditorTaskId", "Stable task ID")}>
                    <TextInput
                      mono
                      value={draft.id}
                      onChange={(id) =>
                        updateDraft({
                          ...draft,
                          id,
                          cwd:
                            editor.root && draft.cwd === editorTaskDirectory(editor.root, draft.id)
                              ? editorTaskDirectory(editor.root, id)
                              : draft.cwd,
                        })
                      }
                    />
                  </Field>
                ) : (
                  <code className="auto-page-editor-muted type-mono-label">{editor.savedTaskId}</code>
                )}
              </fieldset>
              <div className="auto-page-editor-header-actions">
                <Button
                  disabled={
                    editor.busy ||
                    editor.loading ||
                    !editor.hostOnline ||
                    !!editor.invalidFields.length ||
                    (mode === "raw" && !editor.rawSpec)
                  }
                  onClick={adjustWithAi}
                >
                  <AutomationIcon name="sparkles" />
                  {t("autoPageEditorAiAdjust", "Let AI adjust")}
                </Button>
                <div className="auto-page-editor-mode" role="group" aria-label={t("autoPageEditorMode", "Editor mode")}>
                  {(["visual", "raw"] as const).map((next) => (
                    <Button
                      key={next}
                      variant="ghost"
                      disabled={editor.busy}
                      aria-pressed={mode === next}
                      onClick={() => switchMode(next)}
                    >
                      {next === "raw" && <AutomationIcon name="code" />}
                      {next === "visual"
                        ? t("autoPageEditorVisualMode", "Visual editor")
                        : t("autoPageEditorRawMode", "Raw configuration")}
                    </Button>
                  ))}
                </div>
              </div>
            </header>
            <fieldset
              className="auto-page-editor-target"
              disabled={editor.busy || editor.loading || editor.loadFailed || mode === "raw"}
            >
              <Field label={t("autoPageEditorHost", "Target host")}>
                <NativeSelect
                  value={editor.environmentId}
                  disabled={!!editor.savedTaskId}
                  onChange={(event) => {
                    void editor.selectHost(event.target.value);
                  }}
                >
                  {!hosts.some((entry) => entry.environment.id === editor.environmentId) && (
                    <option value={editor.environmentId}>{editor.environmentId}</option>
                  )}
                  {hosts.map((entry) => (
                    <option
                      key={entry.environment.id}
                      value={entry.environment.id}
                      disabled={entry.status !== "online"}
                    >
                      {entry.environment.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <HostChip environmentId={editor.environmentId} />
              <Field label={t("autoPageEditorWorkingDirectory", "Working directory")}>
                <TextInput mono value={draft.cwd} onChange={(cwd) => updateDraft({ ...draft, cwd })} />
              </Field>
              {editor.environmentId === "primary" && (
                <Button
                  onClick={() => {
                    void window.piBridge
                      .selectDirectory()
                      .then((cwd) => {
                        if (cwd) updateDraft({ ...draft, cwd });
                      })
                      .catch((failure: unknown) => editor.setError(editorError(failure)));
                  }}
                >
                  {t("autoPageEditorChooseDirectory", "Choose folder")}
                </Button>
              )}
              <p className="auto-page-editor-target-hint type-label-default">
                {editor.savedTaskId
                  ? t(
                      "autoPageEditorHostLocked",
                      "This task belongs to this host. Saving a draft pauses automatic triggers; existing runs continue.",
                    )
                  : t(
                      "autoPageEditorHostHint",
                      "Host ownership locks after the first save. Saving a draft does not enable automatic triggers.",
                    )}
              </p>
            </fieldset>
            {editor.error && (
              <div role="alert" className="auto-page-editor-error type-body-default">
                {editor.error}
                {editor.loadFailed && (
                  <Button onClick={editor.retryLoad}>{t("autoPageEditorRetryLoad", "Retry loading task")}</Button>
                )}
              </div>
            )}
            {editor.secretError && (
              <div role="alert" className="auto-page-editor-warning type-label-default">
                {t("autoPageEditorSecretReadFailed", "Could not check secret names on this host.")} {editor.secretError}
                <Button
                  variant="ghost"
                  onClick={() => {
                    void editor.refreshSecrets();
                  }}
                >
                  {t("autoPageEditorRetrySecrets", "Check again")}
                </Button>
              </div>
            )}
            <fieldset
              disabled={editor.busy || editor.loading || editor.loadFailed}
              className="auto-page-editor-workspace"
            >
              <div className="auto-page-editor-main">
                {mode === "visual" ? (
                  <>
                    <EditorStepFlow
                      spec={draft}
                      selectedId={selectedStep?.id}
                      secretNames={editor.secretNames}
                      onSelect={select}
                      onInsert={insert}
                      onMove={(index, delta) => {
                        if (editor.invalidFields.length) return;
                        const steps = [...draft.steps];
                        const target = index + delta;
                        if (target < 0 || target >= steps.length) return;
                        [steps[index], steps[target]] = [steps[target], steps[index]];
                        updateDraft({ ...draft, steps });
                      }}
                      onDelete={(index) => {
                        if (editor.invalidFields.length) return;
                        if (draft.steps[index]?.id === selectedId) setSelectedId(undefined);
                        updateDraft({ ...draft, steps: draft.steps.filter((_, current) => current !== index) });
                      }}
                    />
                    <Field label={t("autoPageEditorDescription", "Task description (optional)")}>
                      <TextInput
                        value={draft.description ?? ""}
                        onChange={(description) => updateDraft({ ...draft, description })}
                      />
                    </Field>
                  </>
                ) : (
                  <label className="auto-page-editor-raw-label type-label-medium">
                    {t("autoPageEditorRawLabel", "Task specification (JSON)")}
                    <textarea
                      spellCheck={false}
                      className="ui-input auto-page-editor-raw type-mono-code"
                      rows={28}
                      value={editor.raw}
                      onChange={(event) => editor.setRaw(event.target.value)}
                      aria-invalid={editor.validation?.valid === false}
                    />
                  </label>
                )}
              </div>
              <aside className="auto-page-editor-inspector">
                <div
                  className="auto-page-editor-inspector-tabs"
                  role="group"
                  aria-label={t("autoPageEditorInspector", "Inspector panel")}
                >
                  {mode === "visual" && (
                    <Button variant="ghost" aria-pressed={panel === "settings"} onClick={() => setPanel("settings")}>
                      {selectedStep
                        ? t("autoPageEditorStepSettings", "Step settings")
                        : t("autoPageEditorTriggers", "Trigger settings")}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    aria-pressed={panel === "permissions" || mode === "raw"}
                    onClick={() => setPanel("permissions")}
                  >
                    {t("autoPageEditorPermissions", "Permissions and risks")}
                    {!!editor.missingSecrets.length && <Badge tone="warning">{editor.missingSecrets.length}</Badge>}
                  </Button>
                </div>
                {mode === "visual" && (
                  <div hidden={panel !== "settings"}>
                    {selectedStep ? (
                      <AutomationStepInspector
                        step={selectedStep}
                        earlierSteps={draft.steps.slice(0, selectedIndex)}
                        environmentId={editor.environmentId}
                        secretNames={editor.secretNames}
                        onChange={(step) => {
                          updateDraft({
                            ...draft,
                            steps: draft.steps.map((entry, index) => (index === selectedIndex ? step : entry)),
                          });
                          setSelectedId(step.id);
                        }}
                      />
                    ) : (
                      <>
                        <AutomationTriggerInspector
                          triggers={draft.triggers}
                          onChange={(triggers) => updateDraft({ ...draft, triggers })}
                          environmentId={editor.environmentId}
                          secretNames={editor.secretNames}
                        />
                        <EditorTaskSettings spec={draft} onChange={updateDraft} />
                      </>
                    )}
                  </div>
                )}
                <div hidden={panel !== "permissions" && mode !== "raw"}>
                  <AutomationPermissionsPanel
                    environmentId={editor.environmentId}
                    spec={currentSpec}
                    validation={editor.validation}
                    validating={editor.validating}
                    secretNames={editor.secretNames}
                    onJump={select}
                  />
                </div>
              </aside>
            </fieldset>
          </div>
          <footer className="auto-page-editor-footer">
            <div className="auto-page-editor-stack">
              <p
                role="status"
                className={
                  editor.error
                    ? "auto-page-editor-error type-label-medium"
                    : editor.canEnable
                      ? "auto-page-editor-valid type-label-medium"
                      : "auto-page-editor-muted type-label-medium"
                }
              >
                {editor.error || status}
              </p>
              <span className="auto-page-editor-muted type-label-default">
                {editor.dirty
                  ? t("autoPageEditorUnsaved", "Unsaved changes")
                  : t("autoPageEditorNoUnsaved", "No unsaved changes")}
              </span>
            </div>
            <div className="auto-page-editor-footer-actions">
              {editor.savedTaskId && (
                <Button variant="ghost" disabled={editor.busy} onClick={backToTask}>
                  {t("autoPageEditorViewTask", "View task")}
                </Button>
              )}
              <Button disabled={!editor.canSave} busy={editor.busy} onClick={() => void editor.save(false)}>
                {t("autoPageEditorSaveDraft", "Save draft")}
              </Button>
              <Button
                variant="primary"
                disabled={!editor.canEnable}
                busy={editor.busy}
                onClick={() => void editor.save(true)}
              >
                <AutomationIcon name="check" />
                {t("autoPageEditorReviewEnable", "Review and enable")}
              </Button>
            </div>
          </footer>
        </div>
      </EditorVariablesContext.Provider>
    </EditorValidityContext.Provider>
  );
}
