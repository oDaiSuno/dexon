import { useRef, useState } from "react";
import type { EnvironmentId } from "@contract/environment";
import type { AutomationChatCard } from "@shared/automation/chat-tools";
import type { Json } from "@shared/automation/spec";
import { ATTENTION_ACTIONS, type AttentionAction, type TaskView } from "@shared/automation/views";
import { useI18n } from "@/i18n";
import { getEnvironmentConnection } from "@/lib/environment-registry";
import {
  AutomationAttentionOutputField,
  EmitSignalSubCard,
  OpenInAutomationButton,
  parseOptionalJsonOutput,
} from "./automation-card-links";

type ActionSubCard = Extract<
  AutomationChatCard,
  { kind: "start_run" | "delete_task" | "resolve_approval" | "resolve_attention" | "emit_signal" }
>;

type StatusBanner = { tone: "success" | "warning" | "danger"; text: string };

function makeRequestId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function attentionLabel(action: AttentionAction, t: (key: string, fallback: string) => string): string {
  switch (action) {
    case "mark_succeeded":
      return t("automationCardAttentionMarkSucceeded", "Mark step succeeded");
    case "retry":
      return t("automationCardAttentionRetry", "Retry step");
    case "mark_failed":
      return t("automationCardAttentionMarkFailed", "Mark step failed");
    case "confirm_cancelled":
      return t("automationCardAttentionConfirmCancelled", "Confirm cancelled");
  }
}

export function AutomationActionSubCard({
  environmentId,
  card,
  liveTask,
  inboxActive,
  onTaskDeleted,
  onInboxResolved,
}: {
  environmentId: EnvironmentId;
  card: ActionSubCard;
  liveTask: TaskView | null | undefined;
  inboxActive: boolean | undefined;
  onTaskDeleted: () => void;
  onInboxResolved: () => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<StatusBanner | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const runRequestRef = useRef<{ key: string; id: string } | null>(null);
  const [approvalJson, setApprovalJson] = useState(() =>
    card.kind === "resolve_approval" && card.defaults !== null ? JSON.stringify(card.defaults, null, 2) : "",
  );
  const [attentionAction, setAttentionAction] = useState<AttentionAction>(
    card.kind === "resolve_attention" && card.suggestedAction ? card.suggestedAction : "retry",
  );
  const [attentionOutputJson, setAttentionOutputJson] = useState("");

  if (card.kind === "start_run") {
    const startRun = async () => {
      setBusy(true);
      setError(null);
      const requestKey = JSON.stringify([card.taskId, card.revision, card.triggerId, card.input]);
      if (!runRequestRef.current || runRequestRef.current.key !== requestKey) {
        runRequestRef.current = { key: requestKey, id: makeRequestId("chat-run") };
      }
      try {
        const connection = getEnvironmentConnection(environmentId);
        const result = await connection.call("automation.startRun", {
          taskId: card.taskId,
          triggerId: card.triggerId,
          expectedRevision: card.revision,
          input: card.input,
          requestId: runRequestRef.current.id,
        });
        if (result.outcome === "admitted" || result.outcome === "enqueued" || result.outcome === "dedupe_hit") {
          setStatusMessage({
            tone: "success",
            text: t("automationCardRunStarted", "Run started ({phase})").replace(
              "{phase}",
              result.phase ?? result.outcome,
            ),
          });
        } else {
          setStatusMessage({
            tone: "warning",
            text: t("automationCardRunSkipped", "Run skipped ({reason})").replace(
              "{reason}",
              result.reason ?? "skipped",
            ),
          });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    };

    return (
      <section className={`automation-card${statusMessage ? " is-settled" : ""}`}>
        <div className="automation-card-head">
          <div className="automation-card-heading">
            <span className="automation-card-kicker type-meta-caps">
              {t("automationCardRunTitle", "Run automation now")}
            </span>
            <span className="automation-card-title type-heading">{card.taskName}</span>
            <p className="automation-card-subtitle type-body-default">{card.reason}</p>
          </div>
          <span className="automation-badge type-mono-meta">
            {t("automationCardTargetLabel", "Trigger")}: {card.triggerId}
          </span>
        </div>

        {card.input !== null && (
          <div className="automation-section">
            <span className="automation-section-title type-meta-caps">{t("automationCardInputLabel", "Input")}</span>
            <pre className="automation-pre type-mono-code">{JSON.stringify(card.input, null, 2)}</pre>
          </div>
        )}

        {statusMessage && (
          <div className={`automation-notice is-${statusMessage.tone} type-label-default`}>{statusMessage.text}</div>
        )}
        {error && <p className="automation-error type-label-default">{error}</p>}

        <div className="automation-actions">
          {liveTask !== null && <OpenInAutomationButton environmentId={environmentId} taskId={card.taskId} />}
          {!statusMessage && (
            <button
              type="button"
              className="automation-btn is-primary type-label-medium"
              disabled={busy || liveTask === null}
              onClick={() => void startRun()}
            >
              {busy ? t("automationCardRunning", "Starting…") : t("automationCardRunNow", "Run now")}
            </button>
          )}
        </div>
      </section>
    );
  }

  if (card.kind === "delete_task") {
    const isDeleted = liveTask === null || statusMessage?.tone === "success";
    const deleteTask = async () => {
      setBusy(true);
      setError(null);
      try {
        const connection = getEnvironmentConnection(environmentId);
        await connection.call("automation.deleteTask", { taskId: card.taskId });
        onTaskDeleted();
        setConfirmingDelete(false);
        setStatusMessage({ tone: "success", text: t("automationCardStatusDeleted", "Task deleted") });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    };

    return (
      <section className={`automation-card${isDeleted ? " is-settled" : ""}`}>
        <div className="automation-card-head">
          <div className="automation-card-heading">
            <span className="automation-card-kicker type-meta-caps">
              {t("automationCardDeleteTitle", "Delete automation task")}
            </span>
            <span className="automation-card-title type-heading">{card.taskName}</span>
            <p className="automation-card-subtitle type-body-default">{card.reason}</p>
          </div>
          {isDeleted && (
            <span className="automation-badge is-danger type-label-medium">
              {t("automationCardStatusDeleted", "Task deleted")}
            </span>
          )}
        </div>

        {!isDeleted && (
          <div className="automation-notice is-danger type-label-default">
            {t("automationCardDeleteWarning", "This removes the task definition and disarms its triggers permanently.")}
          </div>
        )}

        {error && <p className="automation-error type-label-default">{error}</p>}

        {!isDeleted && (
          <div className="automation-actions">
            <OpenInAutomationButton environmentId={environmentId} taskId={card.taskId} />
            {confirmingDelete ? (
              <>
                <button
                  type="button"
                  className="automation-btn type-label-medium"
                  disabled={busy}
                  onClick={() => setConfirmingDelete(false)}
                >
                  {t("automationCardCancel", "Cancel")}
                </button>
                <button
                  type="button"
                  className="automation-btn is-danger type-label-medium"
                  disabled={busy}
                  onClick={() => void deleteTask()}
                >
                  {t("automationCardDeleteConfirm", "Confirm permanent delete")}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="automation-btn is-danger type-label-medium"
                disabled={busy}
                onClick={() => setConfirmingDelete(true)}
              >
                {t("automationCardDeleteAction", "Delete task")}
              </button>
            )}
          </div>
        )}
      </section>
    );
  }

  if (card.kind === "resolve_approval") {
    const settled = inboxActive === false || statusMessage !== null;
    const submitApproval = async (approved: boolean) => {
      let data: Json | undefined;
      if (approved && approvalJson.trim()) {
        try {
          data = JSON.parse(approvalJson) as Json;
        } catch {
          setError(t("automationCardInvalidJson", "Enter valid JSON before submitting."));
          return;
        }
      }
      setBusy(true);
      setError(null);
      try {
        const connection = getEnvironmentConnection(environmentId);
        const result = await connection.call("automation.resolveInbox", {
          runId: card.runId,
          stepIndex: card.stepIndex,
          expectedVersion: card.expectedVersion,
          requestId: makeRequestId("chat-approval"),
          resolution: { kind: "approval", approved, ...(data !== undefined ? { data } : {}) },
        });
        if (result.ok) {
          onInboxResolved();
          setStatusMessage({
            tone: approved ? "success" : "warning",
            text: approved ? t("automationCardApproved", "Approved") : t("automationCardRejected", "Rejected"),
          });
        } else {
          setError(result.issues?.join("; ") || result.reason);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    };

    return (
      <section className={`automation-card${settled ? " is-settled" : ""}`}>
        <div className="automation-card-head">
          <div className="automation-card-heading">
            <span className="automation-card-kicker type-meta-caps">
              {t("automationCardApprovalTitle", "Approval required")} · {card.taskName}
            </span>
            <span className="automation-card-title type-heading">{card.title}</span>
            <p className="automation-card-subtitle type-body-default">{card.prompt ?? card.reason}</p>
          </div>
          {inboxActive === false && !statusMessage && (
            <span className="automation-badge type-label-medium">
              {t("automationCardAlreadyResolved", "Already resolved")}
            </span>
          )}
        </div>

        {card.show !== null && (
          <pre className="automation-pre type-mono-code">{JSON.stringify(card.show, null, 2)}</pre>
        )}

        {!settled && card.fields !== null && (
          <div className="automation-section">
            <span className="automation-section-title type-meta-caps">
              {t("automationCardApprovalDataLabel", "Optional response JSON")}
            </span>
            <textarea
              className="automation-textarea type-mono-code"
              value={approvalJson}
              onChange={(event) => setApprovalJson(event.target.value)}
            />
          </div>
        )}

        {statusMessage && (
          <div className={`automation-notice is-${statusMessage.tone} type-label-default`}>{statusMessage.text}</div>
        )}
        {error && <p className="automation-error type-label-default">{error}</p>}

        <div className="automation-actions">
          <OpenInAutomationButton environmentId={environmentId} taskId={card.taskId} runId={card.runId} />
          {!settled && (
            <>
              <button
                type="button"
                className="automation-btn type-label-medium"
                disabled={busy}
                onClick={() => void submitApproval(false)}
              >
                {t("automationCardReject", "Reject")}
              </button>
              <button
                type="button"
                className="automation-btn is-primary type-label-medium"
                disabled={busy}
                onClick={() => void submitApproval(true)}
              >
                {t("automationCardApprove", "Approve")}
              </button>
            </>
          )}
        </div>
      </section>
    );
  }

  if (card.kind === "resolve_attention") {
    const settled = inboxActive === false || statusMessage?.tone === "success";
    const submitAttention = async () => {
      if (typeof window === "undefined" || typeof window.piBridge?.automationCommand !== "function") {
        setError(t("automationCardUnavailable", "Desktop authorization bridge is unavailable in this window."));
        return;
      }
      let output: Json | undefined;
      if (attentionAction === "mark_succeeded") {
        const parsed = parseOptionalJsonOutput(attentionOutputJson);
        if (!parsed.ok) {
          setError(t("automationCardInvalidJson", "Enter valid JSON before submitting."));
          return;
        }
        output = parsed.value;
      }
      setBusy(true);
      setError(null);
      try {
        const result = await window.piBridge.automationCommand({
          type: "resolve-attention",
          environmentId,
          request: {
            runId: card.runId,
            stepIndex: card.stepIndex,
            expectedVersion: card.expectedVersion,
            requestId: makeRequestId("chat-attention"),
            resolution: {
              kind: "attention",
              action: attentionAction,
              ...(output !== undefined ? { output } : {}),
            },
          },
        });
        if (result.outcome === "resolved") {
          if (result.result.ok) {
            onInboxResolved();
            setStatusMessage({ tone: "success", text: t("automationCardAttentionResolved", "Resolved") });
          } else {
            setError(result.result.issues?.join("; ") || result.result.reason);
          }
        } else {
          setStatusMessage({ tone: "warning", text: t("automationCardStatusCancelled", "Confirmation cancelled") });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    };

    return (
      <section className={`automation-card${settled ? " is-settled" : ""}`}>
        <div className="automation-card-head">
          <div className="automation-card-heading">
            <span className="automation-card-kicker type-meta-caps">
              {t("automationCardAttentionTitle", "Confirm external action outcome")} · {card.taskName}
            </span>
            <span className="automation-card-title type-heading">{card.stepId}</span>
            <p className="automation-card-subtitle type-body-default">{card.reason}</p>
          </div>
          {inboxActive === false && !statusMessage && (
            <span className="automation-badge type-label-medium">
              {t("automationCardAlreadyResolved", "Already resolved")}
            </span>
          )}
        </div>

        <pre className="automation-pre type-mono-code">{JSON.stringify(card.error, null, 2)}</pre>

        {!settled && (
          <div className="automation-section">
            <label className="automation-section-title type-meta-caps">
              {t("automationCardAttentionActionLabel", "Choose how to resolve step {stepId}").replace(
                "{stepId}",
                card.stepId,
              )}
            </label>
            <select
              className="automation-select type-body-default"
              value={attentionAction}
              onChange={(event) => setAttentionAction(event.target.value as AttentionAction)}
            >
              {ATTENTION_ACTIONS.map((action) => (
                <option key={action} value={action}>
                  {attentionLabel(action, t)}
                </option>
              ))}
            </select>
          </div>
        )}

        {!settled && attentionAction === "mark_succeeded" && (
          <AutomationAttentionOutputField value={attentionOutputJson} onChange={setAttentionOutputJson} />
        )}

        {statusMessage && (
          <div className={`automation-notice is-${statusMessage.tone} type-label-default`}>{statusMessage.text}</div>
        )}
        {error && <p className="automation-error type-label-default">{error}</p>}

        <div className="automation-actions">
          <OpenInAutomationButton environmentId={environmentId} taskId={card.taskId} runId={card.runId} />
          {!settled && (
            <button
              type="button"
              className="automation-btn is-primary type-label-medium"
              disabled={busy}
              onClick={() => void submitAttention()}
            >
              {t("automationCardAttentionSubmit", "Review & Resolve")}
            </button>
          )}
        </div>
      </section>
    );
  }

  return <EmitSignalSubCard environmentId={environmentId} card={card} makeRequestId={makeRequestId} />;
}
