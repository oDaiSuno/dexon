import type {
  AgentStepSpec,
  AgentWorkspaceTool,
  SessionThinkingLevel,
  StepSpec,
  WaitStepSpec,
} from "@shared/automation/spec";
import { useI18n } from "@/i18n";
import { Check, Field, NativeSelect, TextInput } from "../form-controls";
import { EditorActionFields } from "./editor-action-fields";
import {
  EditorDurationField,
  EditorEffectField,
  EditorJsonField,
  EditorSection,
  EditorTextField,
  EditorVariableReference,
} from "./editor-controls";
import { useEditorStepLabels } from "./editor-labels";
import { editorNewStep, editorStepKind, editorStepKinds, type EditorStepKind } from "./editor-model";

interface StepInspectorProps {
  step: StepSpec;
  onChange: (step: StepSpec) => void;
  earlierSteps: readonly StepSpec[];
  environmentId: string;
  secretNames: readonly string[] | null;
}

export function AutomationStepInspector({
  step,
  onChange,
  earlierSteps,
  environmentId,
  secretNames,
}: StepInspectorProps) {
  const { t } = useI18n();
  const labels = useEditorStepLabels();
  return (
    <div className="auto-page-editor-inspector-content">
      <EditorSection title={t("autoPageEditorStepSettings", "Step settings")}>
        <Field label={t("autoPageEditorStepKind", "Step kind")}>
          <NativeSelect
            value={editorStepKind(step)}
            onChange={(event) => {
              const next = editorNewStep(event.target.value as EditorStepKind, step.id);
              onChange({
                ...next,
                title: step.title,
                when: step.when,
                stopRunIf: step.stopRunIf,
                timeout: step.timeout,
                onFailure: step.onFailure,
              });
            }}
          >
            {editorStepKinds.map((kind) => (
              <option key={kind} value={kind}>
                {labels[kind]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={t("autoPageEditorStepId", "Stable step ID")}>
          <TextInput mono value={step.id} onChange={(id) => onChange({ ...step, id })} />
        </Field>
        <p className="auto-page-editor-muted type-label-default">
          {t(
            "autoPageEditorStepIdHint",
            "Changing an ID or moving a step can invalidate variable references. Check validation before saving.",
          )}
        </p>
        <Field label={t("autoPageEditorStepTitle", "Step name")}>
          <TextInput value={step.title ?? ""} onChange={(title) => onChange({ ...step, title })} />
        </Field>
      </EditorSection>
      {step.kind === "agent" && <AgentFields step={step} onChange={onChange} earlierSteps={earlierSteps} />}
      {step.kind === "action" && (
        <EditorActionFields
          environmentId={environmentId}
          secretNames={secretNames}
          earlierSteps={earlierSteps}
          call={step.call}
          onChange={(call) => onChange({ ...step, call })}
        />
      )}
      {step.kind === "wait" && <WaitFields step={step} onChange={onChange} earlierSteps={earlierSteps} />}
      <EditorVariableReference steps={earlierSteps} />
      <details className="auto-page-editor-advanced">
        <summary className="type-label-medium">
          {t("autoPageEditorStepAdvanced", "Conditions, timeouts and failure handling")}
        </summary>
        <EditorJsonField
          label={t("autoPageEditorWhen", "Run this step only when (condition JSON)")}
          value={step.when}
          shape="condition"
          onChange={(when) => onChange({ ...step, when })}
        />
        <EditorJsonField
          label={t("autoPageEditorStopRunIf", "Stop the run after this step when (condition JSON)")}
          value={step.stopRunIf}
          shape="condition"
          onChange={(stopRunIf) => onChange({ ...step, stopRunIf })}
        />
        <EditorDurationField
          label={t("autoPageEditorStepTimeout", "Step timeout")}
          value={step.timeout}
          onChange={(timeout) => onChange({ ...step, timeout })}
        />
        <Field label={t("autoPageEditorOnFailure", "After a known failure")}>
          <NativeSelect
            value={step.onFailure ?? "fail_run"}
            onChange={(event) =>
              onChange({ ...step, onFailure: event.target.value === "continue" ? "continue" : "fail_run" })
            }
          >
            <option value="fail_run">{t("autoPageEditorFailRun", "End the run as failed")}</option>
            <option value="continue">{t("autoPageEditorContinue", "Continue to the next step")}</option>
          </NativeSelect>
        </Field>
        {step.kind !== "wait" && (
          <>
            <EditorJsonField
              label={t("autoPageEditorRetryJson", "Retry policy (maxAttempts, backoff, factor)")}
              value={step.retry}
              shape="object"
              onChange={(retry) => onChange({ ...step, retry })}
            />
            <Field label={t("autoPageEditorOnUnknown", "When the external outcome is unknown")}>
              <NativeSelect
                value={step.onUnknown ?? "attention"}
                onChange={(event) =>
                  onChange({ ...step, onUnknown: event.target.value === "continue" ? "continue" : "attention" })
                }
              >
                <option value="attention">{t("autoPageEditorNeedAttention", "Pause for human verification")}</option>
                <option value="continue">{t("autoPageEditorContinue", "Continue to the next step")}</option>
              </NativeSelect>
            </Field>
          </>
        )}
      </details>
    </div>
  );
}

function AgentFields({
  step,
  onChange,
  earlierSteps,
}: {
  step: AgentStepSpec;
  onChange: (step: AgentStepSpec) => void;
  earlierSteps: readonly StepSpec[];
}) {
  const { t } = useI18n();
  const tools: readonly AgentWorkspaceTool[] = ["read", "grep", "find", "write", "edit", "bash"];
  return (
    <>
      <EditorTextField
        label={t("autoPageEditorAgentPrompt", "Instructions for AI")}
        value={step.prompt}
        onChange={(prompt) => onChange({ ...step, prompt })}
        steps={earlierSteps}
        multiline
      />
      <EditorSection title={t("autoPageEditorAgentTools", "Allowed AI tools")}>
        <div className="auto-page-editor-tool-grid">
          {tools.map((tool) => (
            <Check
              key={tool}
              label={tool}
              checked={step.tools.includes(tool)}
              onChange={(checked) =>
                onChange({
                  ...step,
                  tools: checked ? [...step.tools, tool] : step.tools.filter((entry) => entry !== tool),
                })
              }
            />
          ))}
        </div>
        <p className="auto-page-editor-muted type-label-default">
          {t(
            "autoPageEditorAgentToolsHint",
            "Write, edit and shell tools can change files or external state. Grant only what this task needs.",
          )}
        </p>
      </EditorSection>
      <EditorEffectField value={step.effect} onChange={(effect) => onChange({ ...step, effect })} />
      <EditorJsonField
        variables
        label={t("autoPageEditorAgentData", "Additional AI input (JSON)")}
        value={step.data}
        onChange={(data) => onChange({ ...step, data })}
      />
      <EditorJsonField
        label={t("autoPageEditorOutputSchema", "Required AI output schema (JSON)")}
        value={step.output.schema}
        optional={false}
        shape="object"
        onChange={(schema) => {
          if (schema) onChange({ ...step, output: { schema } });
        }}
      />
      <details className="auto-page-editor-advanced">
        <summary className="type-label-medium">
          {t("autoPageEditorModelSettings", "Model and reasoning settings")}
        </summary>
        <EditorJsonField
          label={t("autoPageEditorModelJson", "Model (provider, modelId; leave blank for default)")}
          value={step.model}
          shape="object"
          onChange={(model) => onChange({ ...step, model })}
        />
        <Field label={t("autoPageEditorThinking", "Reasoning effort")}>
          <NativeSelect
            value={step.thinkingLevel ?? ""}
            onChange={(event) =>
              onChange({
                ...step,
                thinkingLevel: (event.target.value || undefined) as SessionThinkingLevel | undefined,
              })
            }
          >
            <option value="">{t("autoPageEditorDefault", "Use default")}</option>
            {["off", "minimal", "low", "medium", "high", "xhigh", "max"].map((level) => (
              <option key={level}>{level}</option>
            ))}
          </NativeSelect>
        </Field>
      </details>
    </>
  );
}

function WaitFields({
  step,
  onChange,
  earlierSteps,
}: {
  step: WaitStepSpec;
  onChange: (step: WaitStepSpec) => void;
  earlierSteps: readonly StepSpec[];
}) {
  const { t } = useI18n();
  const wait = step.wait;
  return (
    <>
      {wait.kind === "duration" && (
        <EditorDurationField
          label={t("autoPageEditorDelayDuration", "Wait for")}
          value={wait.duration}
          optional={false}
          onChange={(duration) => {
            if (duration) onChange({ ...step, wait: { ...wait, duration } });
          }}
        />
      )}
      {wait.kind === "signal" && (
        <>
          <Field label={t("autoPageEditorSignalName", "Signal name")}>
            <TextInput value={wait.signal} onChange={(signal) => onChange({ ...step, wait: { ...wait, signal } })} />
          </Field>
          <EditorTextField
            label={t("autoPageEditorSignalKey", "Correlation key")}
            value={wait.key}
            onChange={(key) => onChange({ ...step, wait: { ...wait, key } })}
            steps={earlierSteps}
          />
          <Field label={t("autoPageEditorSignalHistory", "Which signals may satisfy this wait")}>
            <NativeSelect
              value={wait.history ?? "run-start"}
              onChange={(event) =>
                onChange({
                  ...step,
                  wait: { ...wait, history: event.target.value === "retained" ? "retained" : "run-start" },
                })
              }
            >
              <option value="run-start">
                {t("autoPageEditorSignalSinceStart", "Only signals since this run started")}
              </option>
              <option value="retained">{t("autoPageEditorSignalRetained", "Include retained earlier signals")}</option>
            </NativeSelect>
          </Field>
        </>
      )}
      {wait.kind === "approval" && (
        <>
          <EditorTextField
            label={t("autoPageEditorApprovalTitle", "Approval title")}
            value={wait.title}
            onChange={(title) => onChange({ ...step, wait: { ...wait, title } })}
            steps={earlierSteps}
          />
          <EditorTextField
            label={t("autoPageEditorApprovalPrompt", "Instructions for the reviewer")}
            value={wait.prompt ?? ""}
            onChange={(prompt) => onChange({ ...step, wait: { ...wait, prompt } })}
            steps={earlierSteps}
            multiline
          />
          <EditorJsonField
            variables
            label={t("autoPageEditorApprovalShow", "Information to show the reviewer (JSON)")}
            value={wait.show}
            onChange={(show) => onChange({ ...step, wait: { ...wait, show } })}
          />
          <EditorJsonField
            label={t("autoPageEditorApprovalFields", "Approval form schema (object JSON schema)")}
            value={wait.fields}
            shape="object"
            onChange={(fields) => onChange({ ...step, wait: { ...wait, fields } })}
          />
          <EditorJsonField
            variables
            label={t("autoPageEditorApprovalDefaults", "Approval form defaults (JSON)")}
            value={wait.defaults}
            onChange={(defaults) => onChange({ ...step, wait: { ...wait, defaults } })}
          />
          <EditorJsonField
            label={t("autoPageEditorApprovalNotify", "Notification (to: {accountId, peerId}, optional text)")}
            value={wait.notify}
            shape="object"
            onChange={(notify) => onChange({ ...step, wait: { ...wait, notify } })}
          />
        </>
      )}
      <EditorDurationField
        label={t("autoPageEditorExpiresIn", "Wait expires after (optional)")}
        value={step.expiresIn}
        onChange={(expiresIn) => onChange({ ...step, expiresIn })}
      />
      <Field label={t("autoPageEditorOnTimeout", "When this wait expires")}>
        <NativeSelect
          value={step.onTimeout ?? "fail"}
          onChange={(event) =>
            onChange({ ...step, onTimeout: event.target.value === "continue" ? "continue" : "fail" })
          }
        >
          <option value="fail">{t("autoPageEditorFailRun", "End the run as failed")}</option>
          <option value="continue">{t("autoPageEditorContinue", "Continue to the next step")}</option>
        </NativeSelect>
      </Field>
    </>
  );
}
