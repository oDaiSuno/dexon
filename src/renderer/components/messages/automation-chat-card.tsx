import { useCallback, useEffect, useState } from "react";
import type { EnvironmentId } from "@contract/environment";
import type { AutomationChatCard } from "@shared/automation/chat-tools";
import type { TaskView } from "@shared/automation/views";
import { useI18n } from "@/i18n";
import { getEnvironmentConnection } from "@/lib/environment-registry";
import { AutomationActionSubCard } from "./automation-action-subcards";
import { AutomationPermissionsSection } from "./automation-card-permissions";

export interface SurfacedAutomationCard {
  readonly key: string;
  readonly card: AutomationChatCard;
}

export function AutomationChatCardList({
  environmentId,
  cards,
}: {
  environmentId: EnvironmentId;
  cards: readonly SurfacedAutomationCard[];
}) {
  if (cards.length === 0) return null;
  return (
    <div className="automation-card-stack">
      {cards.map((entry) => (
        <AutomationChatCardView key={entry.key} environmentId={environmentId} card={entry.card} />
      ))}
    </div>
  );
}

export function AutomationChatCardView({
  environmentId,
  card,
}: {
  environmentId: EnvironmentId;
  card: AutomationChatCard;
}) {
  const { t } = useI18n();
  const [liveTask, setLiveTask] = useState<TaskView | null | undefined>(undefined);
  const [inboxActive, setInboxActive] = useState<boolean | undefined>(undefined);
  const [configuredSecrets, setConfiguredSecrets] = useState<ReadonlySet<string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ tone: "success" | "warning" | "danger"; text: string } | null>(
    null,
  );
  const [secretInput, setSecretInput] = useState("");

  const taskId = "taskId" in card ? card.taskId : null;
  const needsSecretNames =
    card.kind === "draft_saved" || card.kind === "enable_task" || card.kind === "configure_secret";

  const refreshSecrets = useCallback(async () => {
    if (!needsSecretNames) return;
    if (typeof window === "undefined" || typeof window.piBridge?.automationCommand !== "function") return;
    try {
      const result = await window.piBridge.automationCommand({ type: "list-secret-names", environmentId });
      setConfiguredSecrets(new Set(result.names));
    } catch {
      setConfiguredSecrets(null);
    }
  }, [environmentId, needsSecretNames]);

  const refreshRuntimeState = useCallback(async () => {
    if (card.kind === "configure_secret") return;
    try {
      const connection = getEnvironmentConnection(environmentId);
      if (taskId) {
        const { tasks } = await connection.call("automation.listTasks");
        setLiveTask(tasks.find((item) => item.id === taskId) ?? null);
      }
      if (card.kind === "resolve_approval" || card.kind === "resolve_attention") {
        const { items } = await connection.call("automation.listInbox");
        const exists = items.some(
          (item) =>
            item.runId === card.runId &&
            item.stepIndex === card.stepIndex &&
            item.expectedVersion === card.expectedVersion,
        );
        setInboxActive(exists);
      }
    } catch {
      setLiveTask((prev) => prev);
    }
  }, [card, environmentId, taskId]);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void refreshSecrets();
    void refreshRuntimeState();
    if (card.kind !== "configure_secret") {
      const connection = getEnvironmentConnection(environmentId);
      void connection
        .subscribe(
          "automation.changed",
          "*",
          () => {
            if (active) void refreshRuntimeState();
          },
          () => {
            if (active) void refreshRuntimeState();
          },
        )
        .then((off) => {
          if (active) unsubscribe = off;
          else off();
        })
        .catch(() => {});
    }
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [card.kind, environmentId, refreshRuntimeState, refreshSecrets]);

  const enableTask = async (revision: number, planHash: string) => {
    if (typeof window === "undefined" || typeof window.piBridge?.automationCommand !== "function") {
      setError(t("automationCardUnavailable", "Desktop authorization bridge is unavailable in this window."));
      return;
    }
    if (!taskId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await window.piBridge.automationCommand({
        type: "enable-task",
        environmentId,
        taskId,
        revision,
        planHash,
      });
      if (result.outcome === "enabled") {
        setLiveTask(result.task);
        setStatusMessage({
          tone: "success",
          text: t("automationCardStatusEnabled", "Enabled (v{revision})").replace("{revision}", String(revision)),
        });
      } else {
        setStatusMessage({ tone: "warning", text: t("automationCardStatusCancelled", "Confirmation cancelled") });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (card.kind === "draft_saved" || card.kind === "enable_task") {
    const isEnabledNow = liveTask !== undefined && liveTask !== null && liveTask.enabledRevision === card.revision;
    const isSuperseded = liveTask !== undefined && liveTask !== null && liveTask.currentRevision > card.revision;
    const isDeleted = liveTask === null;
    const stepLabel =
      card.stepCount === 1
        ? t("automationCardStepOne", "1 step")
        : t("automationCardStepCount", "{count} steps").replace("{count}", String(card.stepCount));
    const kicker =
      card.kind === "draft_saved"
        ? card.mode === "create"
          ? t("automationCardDraftCreated", "Automation draft ready")
          : t("automationCardDraftUpdated", "Automation update ready")
        : t("automationCardEnableTitle", "Enable automation task");

    return (
      <section className={`automation-card${isEnabledNow || isSuperseded || isDeleted ? " is-settled" : ""}`}>
        <div className="automation-card-head">
          <div className="automation-card-heading">
            <span className="automation-card-kicker type-meta-caps">{kicker}</span>
            <span className="automation-card-title type-heading">{card.taskName}</span>
            <p className="automation-card-subtitle type-body-default">
              {card.kind === "draft_saved" ? card.summary : card.reason}
            </p>
          </div>
          <div className="automation-card-badges">
            <span className="automation-badge type-mono-meta">
              {t("automationCardRevision", "Revision v{revision}").replace("{revision}", String(card.revision))}
            </span>
            <span className="automation-badge type-label-default">{stepLabel}</span>
            {isEnabledNow && (
              <span className="automation-badge is-success type-label-medium">
                {t("automationCardStatusEnabled", "Enabled (v{revision})").replace("{revision}", String(card.revision))}
              </span>
            )}
            {isSuperseded && liveTask && (
              <span className="automation-badge is-warning type-label-medium">
                {t("automationCardStatusSuperseded", "Superseded by v{revision}").replace(
                  "{revision}",
                  String(liveTask.currentRevision),
                )}
              </span>
            )}
            {isDeleted && (
              <span className="automation-badge is-danger type-label-medium">
                {t("automationCardStatusDeleted", "Task deleted")}
              </span>
            )}
          </div>
        </div>

        {card.kind === "draft_saved" && card.disarmedPreviousRevision !== null && !isEnabledNow && !isDeleted && (
          <div className="automation-notice type-label-default">
            {t(
              "automationCardDisarmedNotice",
              "Previous active revision v{revision} was paused when saving this draft. Enable this revision to resume.",
            ).replace("{revision}", String(card.disarmedPreviousRevision))}
          </div>
        )}

        <AutomationPermissionsSection
          environmentId={environmentId}
          triggers={card.triggers}
          requiredGrant={card.requiredGrant}
          configuredSecrets={configuredSecrets}
          onSecretChanged={() => void refreshSecrets()}
        />

        {statusMessage && !isEnabledNow && (
          <div className={`automation-notice is-${statusMessage.tone} type-label-default`}>{statusMessage.text}</div>
        )}
        {error && <p className="automation-error type-label-default">{error}</p>}

        {!isEnabledNow && !isSuperseded && !isDeleted && (
          <div className="automation-actions">
            <button
              type="button"
              className="automation-btn is-primary type-label-medium"
              disabled={busy}
              onClick={() => void enableTask(card.revision, card.planHash)}
            >
              {busy
                ? t("automationCardEnabling", "Opening desktop confirmation…")
                : t("automationCardReviewEnable", "Review & Enable")}
            </button>
          </div>
        )}
      </section>
    );
  }

  if (card.kind === "configure_secret") {
    const isConfigured = configuredSecrets?.has(card.secretName) ?? false;
    const submitSecret = async () => {
      if (typeof window === "undefined" || typeof window.piBridge?.automationCommand !== "function") {
        setError(t("automationCardUnavailable", "Desktop authorization bridge is unavailable in this window."));
        return;
      }
      setBusy(true);
      setError(null);
      try {
        if (card.operation === "delete") {
          await window.piBridge.automationCommand({
            type: "delete-secret",
            environmentId,
            name: card.secretName,
          });
          setStatusMessage({ tone: "success", text: t("automationCardSecretDeleted", "Secret removed from vault") });
        } else {
          await window.piBridge.automationCommand({
            type: "set-secret",
            environmentId,
            name: card.secretName,
            value: secretInput,
          });
          setSecretInput("");
          setStatusMessage({
            tone: "success",
            text: t("automationCardSecretSaved", "Secret saved to encrypted vault"),
          });
        }
        await refreshSecrets();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    };

    return (
      <section className="automation-card">
        <div className="automation-card-head">
          <div className="automation-card-heading">
            <span className="automation-card-kicker type-meta-caps">
              {card.operation === "delete"
                ? t("automationCardSecretDeleteTitle", "Remove automation secret")
                : t("automationCardSecretTitle", "Configure automation secret")}
            </span>
            <span className="automation-card-title type-mono-body">{card.secretName}</span>
            <p className="automation-card-subtitle type-body-default">{card.reason}</p>
          </div>
          <span className={`automation-badge type-label-medium${isConfigured ? " is-success" : " is-warning"}`}>
            {isConfigured
              ? t("automationCardSecretConfigured", "Configured")
              : t("automationCardSecretMissing", "Missing")}
          </span>
        </div>

        <span className="automation-card-kicker type-meta-default">
          {t(
            "automationCardSecretNotice",
            "Secret values go directly to the encrypted desktop vault and never enter chat.",
          )}
        </span>

        {card.operation === "set" && (
          <div className="automation-secret-input-row">
            <input
              type="password"
              className="automation-input type-body-default"
              value={secretInput}
              placeholder={t(
                "automationCardSecretPlaceholder",
                "Enter secret value (stored encrypted in desktop vault)",
              )}
              onChange={(event) => setSecretInput(event.target.value)}
              autoComplete="off"
            />
            <button
              type="button"
              className="automation-btn is-primary type-label-medium"
              disabled={busy || !secretInput}
              onClick={() => void submitSecret()}
            >
              {t("automationCardSecretSave", "Save to vault")}
            </button>
          </div>
        )}

        {card.operation === "delete" && (
          <div className="automation-actions">
            <button
              type="button"
              className="automation-btn is-danger type-label-medium"
              disabled={busy || !isConfigured}
              onClick={() => void submitSecret()}
            >
              {t("automationCardSecretDelete", "Delete secret")}
            </button>
          </div>
        )}

        {statusMessage && (
          <div className={`automation-notice is-${statusMessage.tone} type-label-default`}>{statusMessage.text}</div>
        )}
        {error && <p className="automation-error type-label-default">{error}</p>}
      </section>
    );
  }

  return (
    <AutomationActionSubCard
      environmentId={environmentId}
      card={card}
      liveTask={liveTask}
      inboxActive={inboxActive}
      onTaskDeleted={() => setLiveTask(null)}
      onInboxResolved={() => setInboxActive(false)}
    />
  );
}
