import type { StepSpec, TaskSpec } from "@shared/automation/spec";
import { useI18n } from "@/i18n";
import { Badge, Button, NativeSelect } from "../form-controls";
import { AutomationIcon } from "./automation-icons";
import { formatTrigger } from "./automation-format";
import { useEditorStepLabels } from "./editor-labels";
import { editorSecrets, editorStepKind, editorStepKinds, type EditorStepKind } from "./editor-model";

export interface EditorFlowProps {
  spec: TaskSpec;
  selectedId?: string;
  secretNames: readonly string[] | null;
  onSelect: (id?: string) => void;
  onMove: (index: number, delta: number) => void;
  onDelete: (index: number) => void;
  onInsert: (index: number, kind: EditorStepKind) => void;
}

function summary(step: StepSpec): string {
  if (step.kind === "agent") return typeof step.prompt === "string" ? step.prompt : step.prompt.$tmpl;
  if (step.kind === "wait") {
    if (step.wait.kind === "duration") return step.wait.duration;
    if (step.wait.kind === "signal") return step.wait.signal;
    return typeof step.wait.title === "string" ? step.wait.title : step.wait.title.$tmpl;
  }
  const call = step.call;
  if (call.action === "http.request") return `${call.with.method ?? "GET"} ${call.with.url.origin}`;
  if (call.action === "script.run") return call.with.path;
  return `${call.with.to.accountId} / ${call.with.to.peerId}`;
}

export function EditorStepFlow({
  spec,
  selectedId,
  secretNames,
  onSelect,
  onMove,
  onDelete,
  onInsert,
}: EditorFlowProps) {
  const { t } = useI18n();
  const labels = useEditorStepLabels();
  const insert = (index: number) => (
    <div className="auto-page-editor-insert" key={`insert-${index}`}>
      <NativeSelect
        value=""
        aria-label={t("autoPageEditorInsertStep", "Insert a step here")}
        onChange={(event) => {
          if (event.target.value) onInsert(index, event.target.value as EditorStepKind);
        }}
      >
        <option value="">{t("autoPageEditorInsertStep", "Insert a step here")}</option>
        {editorStepKinds.map((kind) => (
          <option key={kind} value={kind}>
            {labels[kind]}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
  return (
    <section className="auto-page-editor-flow">
      <h2 className="type-heading">{t("autoPageEditorFlow", "Execution flow")}</h2>
      <Button
        className="auto-page-editor-trigger-node"
        aria-pressed={selectedId === undefined}
        onClick={() => onSelect()}
      >
        <AutomationIcon name="clock" />
        <span className="auto-page-editor-stack">
          <span>{t("autoPageEditorTriggerStart", "When the task starts")}</span>
          <span className="auto-page-editor-muted type-label-default">
            {spec.triggers.length
              ? spec.triggers.map(formatTrigger).join(" · ")
              : t("autoPageEditorNoTriggers", "Add at least one trigger")}
          </span>
        </span>
        <AutomationIcon name="chevron" />
      </Button>
      {insert(0)}
      {spec.steps.map((step, index) => (
        <div className="auto-page-editor-flow-item" key={index}>
          <article className="auto-page-editor-step-card" data-selected={selectedId === step.id || undefined}>
            <div className="auto-page-editor-inline">
              <span className="auto-page-editor-step-number type-mono-label">{index + 1}</span>
              <Button variant="ghost" className="auto-page-editor-step-open" onClick={() => onSelect(step.id)}>
                <span className="auto-page-editor-stack">
                  <span className="type-body-medium">{step.title || step.id}</span>
                  <span className="auto-page-editor-step-summary type-label-default">{summary(step)}</span>
                </span>
              </Button>
              <Badge tone="neutral">{labels[editorStepKind(step)]}</Badge>
            </div>
            <div className="auto-page-editor-inline">
              {secretNames !== null && editorSecrets(step).some((name) => !secretNames.includes(name)) && (
                <Badge tone="warning">{t("autoPageEditorMissingSecretBadge", "Missing secret")}</Badge>
              )}
              <Button
                variant="ghost"
                aria-label={t("autoPageEditorMoveUp", "Move step up")}
                disabled={index === 0}
                onClick={() => onMove(index, -1)}
              >
                <AutomationIcon name="arrowUp" />
              </Button>
              <Button
                variant="ghost"
                aria-label={t("autoPageEditorMoveDown", "Move step down")}
                disabled={index === spec.steps.length - 1}
                onClick={() => onMove(index, 1)}
              >
                <AutomationIcon name="arrowDown" />
              </Button>
              <Button
                variant="ghost"
                aria-label={t("autoPageEditorDeleteStep", "Delete step")}
                onClick={() => onDelete(index)}
              >
                <AutomationIcon name="trash" />
              </Button>
            </div>
          </article>
          {insert(index + 1)}
        </div>
      ))}
      {!spec.steps.length && (
        <p className="auto-page-editor-muted type-body-default">
          {t("autoPageEditorNoSteps", "Choose a step kind above to begin. A task must contain at least one step.")}
        </p>
      )}
    </section>
  );
}
