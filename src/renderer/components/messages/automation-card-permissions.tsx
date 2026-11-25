import { useState } from "react";
import type { EnvironmentId } from "@contract/environment";
import type { AutomationTriggerSummary } from "@shared/automation/chat-tools";
import type { RequiredGrant } from "@shared/automation/spec";
import { useI18n } from "@/i18n";

function formatTrigger(trigger: AutomationTriggerSummary, t: (key: string, fallback: string) => string): string {
  if (trigger.kind === "manual") return t("automationCardTriggerManual", "Manual run");
  if (trigger.kind === "schedule") {
    if (trigger.cron) {
      const base = t("automationCardTriggerCron", "Schedule ({cron})").replace("{cron}", trigger.cron);
      return trigger.tz ? `${base} · ${trigger.tz}` : base;
    }
    return t("automationCardTriggerEvery", "Every {every}").replace("{every}", trigger.every ?? "");
  }
  const template =
    trigger.probeKind === "script.run"
      ? t("automationCardTriggerWatchScript", "Watch script every {every}")
      : t("automationCardTriggerWatchHttp", "Watch HTTP every {every}");
  return template.replace("{every}", trigger.every);
}

export function AutomationPermissionsSection({
  environmentId,
  triggers,
  requiredGrant,
  configuredSecrets,
  onSecretChanged,
}: {
  environmentId: EnvironmentId;
  triggers: readonly AutomationTriggerSummary[];
  requiredGrant: RequiredGrant;
  configuredSecrets: ReadonlySet<string> | null;
  onSecretChanged: () => void;
}) {
  const { t } = useI18n();
  const [editingSecret, setEditingSecret] = useState<string | null>(null);
  const [secretValue, setSecretValue] = useState("");
  const [savingSecret, setSavingSecret] = useState(false);
  const [secretError, setSecretError] = useState<string | null>(null);

  const hasExternal =
    requiredGrant.httpOrigins.length > 0 ||
    requiredGrant.channelTargets.length > 0 ||
    requiredGrant.scripts.length > 0 ||
    requiredGrant.secrets.length > 0 ||
    requiredGrant.agentTools.length > 0;

  const saveSecret = async (name: string) => {
    const trimmed = secretValue;
    if (!trimmed) return;
    if (typeof window === "undefined" || typeof window.piBridge?.automationCommand !== "function") {
      setSecretError(t("automationCardUnavailable", "Desktop authorization bridge is unavailable in this window."));
      return;
    }
    setSavingSecret(true);
    setSecretError(null);
    try {
      await window.piBridge.automationCommand({
        type: "set-secret",
        environmentId,
        name,
        value: trimmed,
      });
      setSecretValue("");
      setEditingSecret(null);
      onSecretChanged();
    } catch (error) {
      setSecretError(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingSecret(false);
    }
  };

  return (
    <>
      <div className="automation-section">
        <span className="automation-section-title type-meta-caps">{t("automationCardTriggersLabel", "Triggers")}</span>
        <div className="automation-chip-list">
          {triggers.map((trigger) => (
            <span key={trigger.id} className="automation-badge type-label-default">
              {formatTrigger(trigger, t)}
            </span>
          ))}
        </div>
      </div>

      <div className="automation-section">
        <span className="automation-section-title type-meta-caps">
          {t("automationCardPermissionsLabel", "Permissions for this revision")}
        </span>
        <div className="automation-meta-grid">
          <div className="automation-meta-row">
            <span className="automation-meta-label type-label-default">
              {t("automationCardWorkspaceLabel", "Workspace")}
            </span>
            <span className="automation-meta-value type-mono-label">{requiredGrant.cwd}</span>
          </div>

          {!hasExternal && (
            <div className="automation-meta-value type-label-default">
              {t(
                "automationCardNoExternalPermissions",
                "Read-only within workspace; no external network, scripts, or secrets.",
              )}
            </div>
          )}

          {requiredGrant.agentTools.length > 0 && (
            <div className="automation-meta-row">
              <span className="automation-meta-label type-label-default">
                {t("automationCardAgentToolsLabel", "AI tools")}
              </span>
              <div className="automation-chip-list">
                {requiredGrant.agentTools.map((tool) => (
                  <span key={tool} className="automation-badge type-mono-meta">
                    {tool}
                  </span>
                ))}
              </div>
            </div>
          )}

          {requiredGrant.httpOrigins.length > 0 && (
            <div className="automation-meta-row">
              <span className="automation-meta-label type-label-default">
                {t("automationCardHttpOriginsLabel", "External hosts")}
              </span>
              <div className="automation-chip-list">
                {requiredGrant.httpOrigins.map((origin) => (
                  <span key={origin} className="automation-badge type-mono-meta">
                    {origin}
                  </span>
                ))}
              </div>
            </div>
          )}

          {requiredGrant.channelTargets.length > 0 && (
            <div className="automation-meta-row">
              <span className="automation-meta-label type-label-default">
                {t("automationCardChannelsLabel", "Messaging targets")}
              </span>
              <div className="automation-chip-list">
                {requiredGrant.channelTargets.map((target) => {
                  const label = `${target.accountId} · ${target.peerId}`;
                  return (
                    <span key={label} className="automation-badge type-mono-meta">
                      {label}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {requiredGrant.scripts.length > 0 && (
            <div className="automation-meta-row">
              <span className="automation-meta-label type-label-default">
                {t("automationCardScriptsLabel", "Local scripts")}
              </span>
              <div className="automation-chip-list">
                {requiredGrant.scripts.map((script) => (
                  <span key={script.path} className="automation-badge type-mono-meta" title={script.sha256}>
                    {script.path}
                  </span>
                ))}
              </div>
            </div>
          )}

          {requiredGrant.secrets.length > 0 && (
            <div className="automation-meta-row">
              <span className="automation-meta-label type-label-default">
                {t("automationCardSecretsLabel", "Secrets")}
              </span>
              <div className="automation-meta-grid" style={{ flex: 1 }}>
                {requiredGrant.secrets.map((name) => {
                  const configured = configuredSecrets?.has(name) ?? false;
                  const isEditing = editingSecret === name;
                  return (
                    <div key={name} className="automation-meta-grid">
                      <div className="automation-secret-row">
                        <span
                          className={`automation-badge type-mono-meta${configured ? " is-success" : " is-warning"}`}
                        >
                          {name} ·{" "}
                          {configured
                            ? t("automationCardSecretConfigured", "Configured")
                            : t("automationCardSecretMissing", "Missing")}
                        </span>
                        <button
                          type="button"
                          className="automation-btn is-compact type-label-medium"
                          onClick={() => {
                            setSecretError(null);
                            setSecretValue("");
                            setEditingSecret(isEditing ? null : name);
                          }}
                        >
                          {isEditing
                            ? t("automationCardCancel", "Cancel")
                            : configured
                              ? t("automationCardSecretUpdate", "Update")
                              : t("automationCardSecretConfigure", "Set secret")}
                        </button>
                      </div>
                      {isEditing && (
                        <div className="automation-secret-editor">
                          <span className="automation-card-kicker type-meta-default">
                            {t(
                              "automationCardSecretNotice",
                              "Secret values go directly to the encrypted desktop vault and never enter chat.",
                            )}
                          </span>
                          <div className="automation-secret-input-row">
                            <input
                              type="password"
                              className="automation-input type-body-default"
                              value={secretValue}
                              placeholder={t(
                                "automationCardSecretPlaceholder",
                                "Enter secret value (stored encrypted in desktop vault)",
                              )}
                              onChange={(event) => setSecretValue(event.target.value)}
                              autoComplete="off"
                            />
                            <button
                              type="button"
                              className="automation-btn is-primary type-label-medium"
                              disabled={savingSecret || !secretValue}
                              onClick={() => void saveSecret(name)}
                            >
                              {t("automationCardSecretSave", "Save to vault")}
                            </button>
                          </div>
                          {secretError && <p className="automation-error type-label-default">{secretError}</p>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {requiredGrant.requiresTrustedLocalExecution && (
        <div className="automation-notice type-label-default">
          {t("automationCardTrustedExecWarning", "Runs local commands or scripts inside the workspace.")}
        </div>
      )}

      {requiredGrant.unattendedWrites.length > 0 && (
        <div className="automation-notice type-label-default">
          {t(
            "automationCardUnattendedWritesWarning",
            "{count} step(s) can write externally without supervision.",
          ).replace("{count}", String(requiredGrant.unattendedWrites.length))}
        </div>
      )}
    </>
  );
}
