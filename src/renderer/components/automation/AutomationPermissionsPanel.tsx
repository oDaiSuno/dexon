import type { RequiredGrant, StepSpec, TaskSpec } from "@shared/automation/spec";
import type { TaskValidationResult } from "@shared/automation/views";
import { useI18n } from "@/i18n";
import { Badge, Button } from "../form-controls";
import { useAutomationWorkspace } from "./automation-context";
import { AutomationIcon } from "./automation-icons";
import { EditorSection } from "./editor-controls";
import { editorAllSecrets, editorSecrets, editorTriggerSecrets } from "./editor-model";

export interface AutomationPermissionsPanelProps {
  environmentId: string;
  spec: TaskSpec;
  validation: TaskValidationResult | null;
  validating?: boolean;
  secretNames: readonly string[] | null;
  onJump?: (stepId?: string) => void;
}

function stepOrigin(step: StepSpec, origin: string): boolean {
  return step.kind === "action" && step.call.action === "http.request" && step.call.with.url.origin === origin;
}

function stepScript(step: StepSpec, path: string): boolean {
  return step.kind === "action" && step.call.action === "script.run" && step.call.with.path === path;
}

export function AutomationPermissionsPanel({
  environmentId,
  spec,
  validation,
  validating = false,
  secretNames,
  onJump,
}: AutomationPermissionsPanelProps) {
  const { t } = useI18n();
  const { openVault } = useAutomationWorkspace();
  const writeLabels = {
    channel_send: t("autoPageEditorWriteChannel", "Send channel messages"),
    http_write: t("autoPageEditorWriteHttp", "Change external services through HTTP"),
    script_write: t("autoPageEditorWriteScript", "Run scripts that may change files or services"),
    agent_write: t("autoPageEditorWriteAgent", "Allow AI to change files or external state"),
  };
  const grant = validation?.requiredGrant;
  const secrets = grant?.secrets ?? editorAllSecrets(spec);
  const jumpLinks = (predicate: (step: StepSpec) => boolean, trigger = false) => (
    <div className="auto-page-editor-permission-sources">
      {onJump &&
        spec.steps.map((step, index) =>
          predicate(step) ? (
            <Button key={step.id} variant="ghost" onClick={() => onJump(step.id)}>
              {t("autoPageEditorFromStep", "From step")} {index + 1}
            </Button>
          ) : null,
        )}
      {onJump && trigger && (
        <Button variant="ghost" onClick={() => onJump()}>
          {t("autoPageEditorFromTrigger", "From trigger")}
        </Button>
      )}
    </div>
  );
  return (
    <div className="auto-page-editor-inspector-content">
      <EditorSection title={t("autoPageEditorPermissions", "Permissions and risks")}>
        <p className="auto-page-editor-muted type-body-default">
          {t(
            "autoPageEditorPermissionsHint",
            "Permissions are derived from the full draft, not from a preset. Review every destination and write before enabling.",
          )}
        </p>
        {validating && (
          <p role="status" className="type-label-default">
            {t("autoPageEditorValidating", "Validating draft…")}
          </p>
        )}
        {validation && !validation.valid && (
          <div className="auto-page-editor-error" role="alert">
            <h4 className="type-label-medium">{t("autoPageEditorValidationIssues", "Fix these validation issues")}</h4>
            <ul className="auto-page-editor-issues">
              {validation.issues.map((issue, index) => (
                <li key={index} className="type-label-default">
                  <code className="type-mono-label">{issue.path}</code> {issue.message}
                  {onJump && (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        const match = /^steps(?:\.|\[)(\d+)/.exec(issue.path);
                        onJump(match ? spec.steps[Number(match[1])]?.id : undefined);
                      }}
                    >
                      {t("autoPageEditorJumpToIssue", "Go to field")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {!grant && !validating && (
          <p className="auto-page-editor-muted type-label-default">
            {t("autoPageEditorGrantUnavailable", "The full permission summary appears after successful validation.")}
          </p>
        )}
      </EditorSection>
      <EditorSection title={t("autoPageEditorSecretReferences", "Secret references")}>
        {secretNames === null && !!secrets.length && (
          <p className="auto-page-editor-warning type-label-default">
            {t(
              "autoPageEditorSecretsUnknown",
              "Secret availability has not been verified on this host. Enabling is blocked until it is checked.",
            )}
          </p>
        )}
        {!secrets.length && (
          <p className="auto-page-editor-muted type-label-default">
            {t("autoPageEditorNoSecrets", "No secrets referenced.")}
          </p>
        )}
        {secrets.map((name) => (
          <div className="auto-page-editor-permission-row" key={name}>
            <div className="auto-page-editor-inline">
              <code className="type-mono-label">{name}</code>
              <Badge tone={secretNames === null ? "warning" : secretNames.includes(name) ? "success" : "danger"}>
                {secretNames === null
                  ? t("autoPageEditorUnchecked", "Unchecked")
                  : secretNames.includes(name)
                    ? t("autoPageEditorPresent", "Present")
                    : t("autoPageEditorMissing", "Missing")}
              </Badge>
              {secretNames !== null && !secretNames.includes(name) && (
                <Button variant="ghost" onClick={() => openVault(environmentId, true)}>
                  <AutomationIcon name="key" />
                  {t("autoPageEditorAddMissingSecret", "Add secret")}
                </Button>
              )}
            </div>
            {jumpLinks(
              (step) => editorSecrets(step).includes(name),
              spec.triggers.some((trigger) => editorTriggerSecrets(trigger).includes(name)),
            )}
          </div>
        ))}
      </EditorSection>
      {grant && (
        <>
          <EditorSection title={t("autoPageEditorWorkingDirectory", "Working directory")}>
            <code className="auto-page-editor-wrap type-mono-label">{grant.cwd}</code>
          </EditorSection>
          <EditorSection title={t("autoPageEditorAgentTools", "Allowed AI tools")}>
            {!grant.agentTools.length && <None />}
            {grant.agentTools.map((tool) => (
              <div className="auto-page-editor-permission-row" key={tool}>
                <code className="type-mono-label">{tool}</code>
                {jumpLinks((step) => step.kind === "agent" && step.tools.includes(tool))}
              </div>
            ))}
          </EditorSection>
          <EditorSection title={t("autoPageEditorHttpOrigins", "External HTTP origins")}>
            {!grant.httpOrigins.length && <None />}
            {grant.httpOrigins.map((origin) => (
              <div className="auto-page-editor-permission-row" key={origin}>
                <code className="auto-page-editor-wrap type-mono-label">{origin}</code>
                {jumpLinks(
                  (step) => stepOrigin(step, origin),
                  spec.triggers.some(
                    (trigger) =>
                      trigger.kind === "watch" &&
                      trigger.probe.action === "http.request" &&
                      trigger.probe.with.url.origin === origin,
                  ),
                )}
              </div>
            ))}
          </EditorSection>
          <EditorSection title={t("autoPageEditorScripts", "Local scripts and file fingerprints")}>
            {!grant.scripts.length && <None />}
            {grant.scripts.map((script) => (
              <div className="auto-page-editor-permission-row" key={script.path}>
                <code className="auto-page-editor-wrap type-mono-label">{script.path}</code>
                <code className="auto-page-editor-wrap type-mono-meta">{script.sha256}</code>
                {jumpLinks(
                  (step) => stepScript(step, script.path),
                  spec.triggers.some(
                    (trigger) =>
                      trigger.kind === "watch" &&
                      trigger.probe.action === "script.run" &&
                      trigger.probe.with.path === script.path,
                  ),
                )}
              </div>
            ))}
          </EditorSection>
          <EditorSection title={t("autoPageEditorChannelTargets", "Channel destinations")}>
            {!grant.channelTargets.length && <None />}
            {grant.channelTargets.map((target) => (
              <div className="auto-page-editor-permission-row" key={JSON.stringify(target)}>
                <code className="auto-page-editor-wrap type-mono-label">
                  {target.accountId} / {target.peerId}
                </code>
                {jumpLinks((step) => {
                  const destination =
                    step.kind === "action" && step.call.action === "channel.send"
                      ? step.call.with.to
                      : step.kind === "wait" && step.wait.kind === "approval"
                        ? step.wait.notify?.to
                        : undefined;
                  return destination?.accountId === target.accountId && destination.peerId === target.peerId;
                })}
              </div>
            ))}
          </EditorSection>
          <EditorSection title={t("autoPageEditorUnattendedWrites", "Writes without an approval step")}>
            {!grant.unattendedWrites.length && <None />}
            {grant.unattendedWrites.map((write) => (
              <div className="auto-page-editor-permission-row" key={write.stepId}>
                <Badge tone="warning">{writeLabels[write.kind]}</Badge>
                <code className="type-mono-label">{write.stepId}</code>
                {jumpLinks((step) => step.id === write.stepId || `${step.id}.notify` === write.stepId)}
              </div>
            ))}
            {!!grant.unattendedWrites.length && (
              <p className="auto-page-editor-warning type-label-default">
                {t(
                  "autoPageEditorWriteWarning",
                  "These writes can happen unattended. Desktop authorization is required; saving a draft does not authorize them.",
                )}
              </p>
            )}
          </EditorSection>
          <GrantDetails grant={grant} />
        </>
      )}
    </div>
  );
}

function None() {
  const { t } = useI18n();
  return <p className="auto-page-editor-muted type-label-default">{t("autoPageEditorNone", "None")}</p>;
}

function GrantDetails({ grant }: { grant: RequiredGrant }) {
  const { t } = useI18n();
  const effectLabels = {
    read: t("autoPageEditorEffectRead", "Read only"),
    idempotent: t("autoPageEditorEffectRepeatSafe", "Safe to repeat within the declared window"),
    unsafe: t("autoPageEditorEffectChangesState", "May change files or external state"),
  };
  return (
    <EditorSection title={t("autoPageEditorExecutionTrust", "Execution trust and plan fingerprint")}>
      <p
        className={
          grant.requiresTrustedLocalExecution ? "auto-page-editor-warning type-label-default" : "type-label-default"
        }
      >
        {grant.requiresTrustedLocalExecution
          ? t("autoPageEditorTrustRequired", "Trusted local execution authorization is required.")
          : t("autoPageEditorNoTrustRequired", "No trusted local execution authorization required.")}
      </p>
      <details className="auto-page-editor-advanced">
        <summary className="type-label-medium">
          {t("autoPageEditorStepEffects", "Derived effects and allowed destinations")}
        </summary>
        {grant.stepEffects.map((effect) => (
          <p key={effect.stepId} className="type-mono-label">
            <code className="type-mono-label">{effect.stepId}</code>: {effectLabels[effect.effect]}
          </p>
        ))}
        {grant.allowedChannelTargets.map((target) => (
          <p key={JSON.stringify(target)} className="type-mono-label">
            {target.accountId} / {target.peerId}
          </p>
        ))}
      </details>
      <code className="auto-page-editor-wrap type-mono-meta">{grant.planHash}</code>
    </EditorSection>
  );
}
