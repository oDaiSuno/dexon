import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { RequiredGrant, UnattendedWrite } from "@shared/automation/spec";
import type { TaskRevisionView } from "@shared/automation/views";
import { useI18n } from "@/i18n";
import { Badge, Button } from "@/components/form-controls";
import { JsonBlock } from "./automation-atoms";
import { useAutomationWorkspace } from "./automation-context";
import { formatStepKind } from "./automation-format";
import { AutomationIcon } from "./automation-icons";
import { taskError } from "./task-data";

export function TaskPermissionSummary({ grant }: { grant: RequiredGrant }) {
  const { t } = useI18n();
  return (
    <div className="auto-page-permission-summary type-meta-default">
      <span>
        {t("autoPageTaskOrigins", "HTTP origins")}: {grant.httpOrigins.length}
      </span>
      <span>
        {t("autoPageTaskSecrets", "Secrets")}: {grant.secrets.length}
      </span>
      <span>
        {t("autoPageTaskWrites", "Unattended writes")}: {grant.unattendedWrites.length}
      </span>
      {grant.requiresTrustedLocalExecution && (
        <Badge tone="warning">{t("autoPageTaskLocalTrust", "Local execution trust required")}</Badge>
      )}
    </div>
  );
}

function GrantField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="auto-page-grant-field">
      <dt className="type-label-medium">{label}</dt>
      <dd className="auto-page-stack-tight type-body-default">{children}</dd>
    </div>
  );
}

function GrantValues({ values }: { values: readonly string[] }) {
  const { t } = useI18n();
  return values.length ? (
    <ul className="auto-page-grant-values type-mono-label">
      {values.map((value, index) => (
        <li key={`${index}:${value}`}>{value}</li>
      ))}
    </ul>
  ) : (
    <span>{t("autoPageTaskNone", "None")}</span>
  );
}

function writeLabel(kind: UnattendedWrite["kind"], labels: Record<UnattendedWrite["kind"], string>) {
  return labels[kind];
}

function useTaskSecretNames(environmentId: string, planHash: string, online: boolean, required: boolean) {
  const { t } = useI18n();
  const { command, openVault, notify, nativeConsentPending, tasks } = useAutomationWorkspace();
  const [secretState, setSecretState] = useState<{ key: string; names: readonly string[] } | null>(null);
  const [checking, setChecking] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const active = useRef(false);
  const inFlight = useRef(false);
  const attempted = useRef<string | null>(null);
  const vaultNeedsRefresh = useRef(false);
  const vaultFocusTarget = useRef<Element | null>(null);
  const previousTasks = useRef(tasks);
  const key = JSON.stringify([environmentId, planHash]);
  const requestKey = JSON.stringify([key, refreshVersion]);
  const label = t("autoPageTaskCheckSecrets", "Check required secrets");
  const refreshNames = useCallback(() => setRefreshVersion((version) => version + 1), []);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const checkNames = useCallback(async () => {
    if (!online || !required || nativeConsentPending || inFlight.current || attempted.current === requestKey) return;
    attempted.current = requestKey;
    inFlight.current = true;
    setChecking(true);
    try {
      const result = await command({ type: "list-secret-names", environmentId }, label);
      if (active.current) setSecretState({ key, names: result.names });
    } catch (error) {
      if (active.current) notify(taskError(error));
    } finally {
      inFlight.current = false;
      if (active.current) setChecking(false);
    }
  }, [online, required, nativeConsentPending, requestKey, command, environmentId, label, key, notify]);

  useEffect(() => {
    if (!online) attempted.current = null;
    else if (!checking) void checkNames();
  }, [online, checking, checkNames]);

  useEffect(() => {
    const onFocus = () => {
      if (inFlight.current || nativeConsentPending) return;
      vaultNeedsRefresh.current = false;
      refreshNames();
    };
    const onVaultFocus = (event: FocusEvent) => {
      if (event.target !== vaultFocusTarget.current) return;
      vaultFocusTarget.current = null;
      vaultNeedsRefresh.current = false;
      refreshNames();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("focusin", onVaultFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("focusin", onVaultFocus);
    };
  }, [nativeConsentPending, refreshNames]);

  useEffect(() => {
    const changed = previousTasks.current !== tasks;
    previousTasks.current = tasks;
    if (changed && vaultNeedsRefresh.current) {
      vaultNeedsRefresh.current = false;
      refreshNames();
    }
  }, [tasks, refreshNames]);

  return {
    names: secretState?.key === key ? secretState.names : null,
    checking,
    disabled: !online || checking || Boolean(nativeConsentPending),
    refreshNames,
    openSecretVault: () => {
      vaultNeedsRefresh.current = true;
      vaultFocusTarget.current = document.activeElement;
      openVault(environmentId, true);
    },
  };
}

function TaskGrantDetails({
  environmentId,
  grant,
  online,
}: {
  environmentId: string;
  grant: RequiredGrant;
  online: boolean;
}) {
  const { t } = useI18n();
  const { names, checking, disabled, refreshNames, openSecretVault } = useTaskSecretNames(
    environmentId,
    grant.planHash,
    online,
    grant.secrets.length > 0,
  );
  const writeLabels = {
    channel_send: t("autoPageTaskWriteChannel", "Send a message"),
    http_write: t("autoPageTaskWriteHttp", "Change remote data"),
    script_write: t("autoPageTaskWriteScript", "Run a script that can make changes"),
    agent_write: t("autoPageTaskWriteAgent", "Allow AI to make changes"),
  };
  const effectLabels = {
    read: t("autoPageTaskEffectRead", "Read only"),
    idempotent: t("autoPageTaskEffectIdempotent", "Repeat-safe changes"),
    unsafe: t("autoPageTaskEffectUnsafe", "Changes may not be safe to repeat"),
  };
  return (
    <section className="auto-page-panel auto-page-stack">
      <div className="auto-page-section-heading">
        <h2 className="type-body-large-medium">{t("autoPageTaskPermissions", "Permissions for this revision")}</h2>
        <TaskPermissionSummary grant={grant} />
      </div>
      <p className="type-body-default">
        {t(
          "autoPageTaskPermissionScope",
          "Enabling this revision authorizes only the permissions listed below. Secret values are never shown here.",
        )}
      </p>
      <dl className="auto-page-grant-grid">
        <GrantField label={t("autoPageTaskWorkingDirectory", "Working directory")}>
          <span className="type-mono-label">{grant.cwd}</span>
        </GrantField>
        <GrantField label={t("autoPageTaskAgentTools", "AI workspace tools")}>
          <GrantValues values={grant.agentTools} />
        </GrantField>
        <GrantField label={t("autoPageTaskOrigins", "HTTP origins")}>
          <GrantValues values={grant.httpOrigins} />
        </GrantField>
        <GrantField label={t("autoPageTaskScripts", "Local scripts and SHA-256 hashes")}>
          {grant.scripts.length ? (
            grant.scripts.map((script, index) => (
              <div key={`${index}:${script.path}`} className="auto-page-stack-tight">
                <span className="type-mono-label">{script.path}</span>
                <span className="auto-page-hash type-mono-meta">{script.sha256}</span>
              </div>
            ))
          ) : (
            <span>{t("autoPageTaskNone", "None")}</span>
          )}
        </GrantField>
        <GrantField label={t("autoPageTaskSecrets", "Secrets")}>
          {grant.secrets.length ? (
            <>
              <Button busy={checking} disabled={disabled} onClick={refreshNames}>
                <AutomationIcon name="key" />
                {t("autoPageTaskCheckSecrets", "Check required secrets")}
              </Button>
              <p className="type-meta-default">
                {t("autoPageTaskSecretsCheckHint", "Checking secret names never reveals their values.")}
              </p>
              <ul className="auto-page-grant-values">
                {grant.secrets.map((secret) => {
                  const present = names?.includes(secret);
                  return (
                    <li key={secret} className="auto-page-secret-row">
                      <span className="type-mono-label">{secret}</span>
                      <Badge tone={names === null ? "muted" : present ? "success" : "warning"}>
                        {names === null
                          ? t("autoPageTaskSecretUnchecked", "Not checked")
                          : present
                            ? t("autoPageTaskSecretReady", "Configured")
                            : t("autoPageTaskSecretMissing", "Missing")}
                      </Badge>
                      {names !== null && !present && (
                        <Button variant="ghost" disabled={disabled} onClick={openSecretVault}>
                          <AutomationIcon name="plus" />
                          {t("autoPageTaskAddSecret", "Add secret")}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <span>{t("autoPageTaskNone", "None")}</span>
          )}
        </GrantField>
        <GrantField label={t("autoPageTaskWrites", "Unattended writes")}>
          <GrantValues
            values={grant.unattendedWrites.map((write) => `${write.stepId} · ${writeLabel(write.kind, writeLabels)}`)}
          />
        </GrantField>
        <GrantField label={t("autoPageTaskChannelTargets", "Message destinations")}>
          <GrantValues values={grant.channelTargets.map((target) => `${target.accountId} → ${target.peerId}`)} />
        </GrantField>
        <GrantField label={t("autoPageTaskAllowedChannels", "Allowed message destinations")}>
          <GrantValues values={grant.allowedChannelTargets.map((target) => `${target.accountId} → ${target.peerId}`)} />
        </GrantField>
        <GrantField label={t("autoPageTaskExecutionTrust", "Trusted local execution")}>
          <span>
            {grant.requiresTrustedLocalExecution
              ? t("autoPageTaskTrustRequired", "Required: local scripts or commands can access this host.")
              : t("autoPageTaskTrustNotRequired", "Not required")}
          </span>
        </GrantField>
        <GrantField label={t("autoPageTaskStepEffects", "What each step can change")}>
          <GrantValues
            values={grant.stepEffects.map((effect) => `${effect.stepId} · ${effectLabels[effect.effect]}`)}
          />
        </GrantField>
        <GrantField label={t("autoPageTaskPlanHash", "Permission plan hash")}>
          <span className="auto-page-hash type-mono-meta">{grant.planHash}</span>
        </GrantField>
      </dl>
    </section>
  );
}

export function TaskFlow({
  environmentId,
  revision,
  online,
}: {
  environmentId: string;
  revision: TaskRevisionView;
  online: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="auto-page-stack">
      <section className="auto-page-panel auto-page-stack">
        <div className="auto-page-section-heading">
          <h2 className="type-body-large-medium">{t("autoPageTaskFlowTitle", "Task flow")}</h2>
          <Badge>{t("autoPageTaskReadOnly", "Read only")}</Badge>
        </div>
        <ol className="auto-page-timeline">
          {revision.source.steps.map((step, index) => (
            <li key={step.id} className="auto-page-timeline-step">
              <span className="auto-page-step-number type-mono-label">{index + 1}</span>
              <div className="auto-page-stack-tight">
                <h3 className="type-body-medium">{step.title ?? step.id}</h3>
                <span className="type-meta-default">{formatStepKind(step)}</span>
                {step.kind === "agent" && typeof step.prompt === "string" && (
                  <p className="auto-page-step-prompt type-body-default">{step.prompt}</p>
                )}
                {step.kind === "action" && step.call.action === "http.request" && (
                  <span className="type-mono-label">
                    {step.call.with.method ?? "GET"} {step.call.with.url.origin}
                  </span>
                )}
                {step.kind === "action" && step.call.action === "script.run" && (
                  <span className="type-mono-label">{step.call.with.path}</span>
                )}
                <details className="auto-page-step-details">
                  <summary className="type-label-default">{t("autoPageTaskStepDefinition", "Step definition")}</summary>
                  <JsonBlock value={step} />
                </details>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <TaskGrantDetails
        key={`${environmentId}:${revision.planHash}`}
        environmentId={environmentId}
        grant={revision.requiredGrant}
        online={online}
      />
    </div>
  );
}
