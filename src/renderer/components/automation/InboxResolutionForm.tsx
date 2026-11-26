import { useRef, useState } from "react";
import type { Json } from "@shared/automation/spec";
import type { AttentionAction, InboxResolution, ResolveInboxResult } from "@shared/automation/views";
import { useI18n } from "@/i18n";
import { Button } from "@/components/form-controls";
import { useAutomationWorkspace, type HostedInbox } from "./automation-context";
import { JsonBlock, OfflineHostNotice } from "./automation-atoms";
import { DrawerSchemaInput, drawerSchemaDefault } from "./drawer-schema-input";
import { drawerError, inboxEntryKey, parseDrawerJson, useDrawerRequestId } from "./drawer-utils";

export function InboxResolutionForm({ entry, onResolved }: { entry: HostedInbox; onResolved?: () => void }) {
  return (
    <ResolutionForm
      key={`${inboxEntryKey(entry)}:${entry.item.expectedVersion}`}
      entry={entry}
      onResolved={onResolved}
    />
  );
}

function ResolutionForm({ entry, onResolved }: { entry: HostedInbox; onResolved?: () => void }) {
  const { t } = useI18n();
  const { call, command, hosts, refresh, nativeConsentPending } = useAutomationWorkspace();
  const { item, environmentId } = entry;
  const cancellation =
    item.kind === "attention" &&
    item.error !== null &&
    typeof item.error === "object" &&
    !Array.isArray(item.error) &&
    item.error.code === "cancel_requires_reconciliation";
  const [action, setAction] = useState<AttentionAction>(cancellation ? "confirm_cancelled" : "retry");
  const [approvalJson, setApprovalJson] = useState(() =>
    item.kind === "approval" ? JSON.stringify(item.defaults ?? drawerSchemaDefault(item.fields) ?? {}, null, 2) : "",
  );
  const [outputJson, setOutputJson] = useState("");
  const [busy, setBusy] = useState(false);
  const [resolved, setResolved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pending = useRef(false);
  const requestId = useDrawerRequestId();
  const online = hosts.some((host) => host.environment.id === environmentId && host.status === "online");
  const expired = item.kind === "approval" && item.expiresAtMs !== null && item.expiresAtMs <= Date.now();
  const disabled = busy || resolved || !online || expired || nativeConsentPending !== null;
  const choices = [
    {
      value: "mark_succeeded",
      label: t("autoPageDrawerMarkSucceeded", "Mark step succeeded"),
      detail: t("autoPageDrawerMarkSucceededHelp", "Continue the run using the result you provide below."),
    },
    {
      value: "retry",
      label: t("autoPageDrawerRetry", "Retry step"),
      detail: t(
        "autoPageDrawerRetryHelp",
        "Run this step again. Check external effects first to avoid doing it twice.",
      ),
    },
    {
      value: "mark_failed",
      label: t("autoPageDrawerMarkFailed", "Mark step failed"),
      detail: t("autoPageDrawerMarkFailedHelp", "End this run as failed without retrying the step."),
    },
    {
      value: "confirm_cancelled",
      label: t("autoPageDrawerConfirmCancelled", "Confirm cancellation"),
      detail: t(
        "autoPageDrawerConfirmCancelledHelp",
        "Confirm that external effects have been checked, then finish cancelling the run.",
      ),
    },
  ] as const;

  const finish = (result: ResolveInboxResult) => {
    if (!result.ok) {
      const reasons = {
        already_resolved: t(
          "autoPageDrawerAlreadyResolved",
          "This item has already been resolved. Refresh to see the latest state.",
        ),
        not_found: t("autoPageDrawerInboxMissing", "This run or step no longer exists."),
        invalid: t("autoPageDrawerResolutionInvalid", "The response does not meet this step's requirements."),
        kind_mismatch: t("autoPageDrawerKindChanged", "This step is no longer waiting for this response."),
        version_conflict: t(
          "autoPageDrawerVersionConflict",
          "The run changed while you were reviewing it. Refresh before trying again.",
        ),
      };
      setError(
        result.issues?.length ? `${reasons[result.reason]} ${result.issues.join("; ")}` : reasons[result.reason],
      );
      return;
    }
    setResolved(true);
    setNotice(t("autoPageDrawerResolved", "Response submitted."));
    onResolved?.();
    void refresh().catch((err: unknown) => setError(drawerError(err)));
  };

  const submit = async (approved = true) => {
    if (pending.current || disabled) return;
    let resolution: InboxResolution;
    try {
      if (item.kind === "approval") {
        const data = approved ? parseDrawerJson(approvalJson, item.defaults ?? {}) : undefined;
        resolution = { kind: "approval", approved, ...(data === undefined ? {} : { data }) };
      } else {
        const output: Json | undefined =
          action === "mark_succeeded" && outputJson.trim() ? parseDrawerJson(outputJson) : undefined;
        resolution = { kind: "attention", action, ...(output === undefined ? {} : { output }) };
      }
    } catch {
      setError(t("autoPageDrawerInvalidJson", "Enter valid JSON with finite numbers before submitting."));
      return;
    }
    pending.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    const base = { runId: item.runId, stepIndex: item.stepIndex, expectedVersion: item.expectedVersion };
    const id = requestId({ environmentId, ...base, resolution });
    try {
      if (resolution.kind === "approval") {
        finish(await call(environmentId, "automation.resolveInbox", { ...base, requestId: id, resolution }));
      } else {
        const result = await command(
          { type: "resolve-attention", environmentId, request: { ...base, requestId: id, resolution } },
          t("autoPageDrawerResolveConsent", "Review attention resolution"),
        );
        if (result.outcome === "cancelled") {
          setNotice(t("autoPageDrawerConsentCancelled", "Authorization cancelled. This item is still unresolved."));
        } else finish(result.result);
      }
    } catch (err) {
      setError(drawerError(err));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="auto-page-resolution-form">
      <OfflineHostNotice environmentId={environmentId} />
      {item.kind === "approval" ? (
        <>
          {item.prompt && <p className="auto-page-muted type-body-relaxed">{item.prompt}</p>}
          {item.show !== null && <JsonBlock value={item.show} />}
          {!resolved && (
            <DrawerSchemaInput
              schema={item.fields}
              value={approvalJson}
              onChange={setApprovalJson}
              disabled={disabled}
              label={t("autoPageDrawerApprovalResponse", "Approval response")}
            />
          )}
          {expired && (
            <p role="alert" className="auto-page-warning type-body-default">
              {t("autoPageDrawerApprovalExpired", "This approval has expired. Refresh to load its current state.")}
            </p>
          )}
        </>
      ) : (
        <>
          <p className="auto-page-notice is-danger type-body-relaxed">
            {t(
              "autoPageDrawerAttentionWarning",
              "The result of an external action is uncertain. Check what actually happened before choosing how to continue.",
            )}
          </p>
          <JsonBlock value={item.error} />
          {!resolved && (
            <fieldset className="auto-page-fieldset auto-page-resolution-choices" disabled={disabled}>
              <legend className="type-label-medium">
                {t("autoPageDrawerChooseResolution", "How should this step continue?")}
              </legend>
              {choices.map((choice) => (
                <label key={choice.value} className="auto-page-radio-card" data-selected={action === choice.value}>
                  <input
                    type="radio"
                    name={`resolution-${environmentId}-${item.runId}-${item.stepIndex}`}
                    value={choice.value}
                    checked={action === choice.value}
                    disabled={
                      cancellation ? choice.value !== "confirm_cancelled" : choice.value === "confirm_cancelled"
                    }
                    onChange={() => setAction(choice.value)}
                  />
                  <span className="auto-page-radio-copy">
                    <span className="type-body-medium">{choice.label}</span>
                    <span className="auto-page-muted type-label-default">{choice.detail}</span>
                  </span>
                </label>
              ))}
              {action === "mark_succeeded" && (
                <DrawerSchemaInput
                  value={outputJson}
                  onChange={setOutputJson}
                  disabled={disabled}
                  label={t("autoPageDrawerSuccessOutput", "Step output (optional JSON)")}
                />
              )}
            </fieldset>
          )}
          {cancellation && (
            <p className="auto-page-muted type-label-default">
              {t(
                "autoPageDrawerCancellationOnly",
                "This run is reconciling a cancellation. Only confirmation of cancellation is available.",
              )}
            </p>
          )}
        </>
      )}
      {notice && (
        <p role="status" className="auto-page-notice type-body-default">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="auto-page-error type-body-default">
          {error}
        </p>
      )}
      {(error || expired) && !resolved && (
        <Button
          variant="ghost"
          disabled={busy || !online}
          onClick={() => {
            void refresh().catch((err: unknown) => setError(drawerError(err)));
          }}
        >
          {t("autoPageDrawerRefresh", "Refresh")}
        </Button>
      )}
      {!resolved && (
        <div className="auto-page-actions">
          {item.kind === "approval" ? (
            <>
              <Button disabled={disabled} onClick={() => void submit(false)}>
                {t("autoPageDrawerReject", "Reject")}
              </Button>
              <Button variant="primary" busy={busy} disabled={disabled} onClick={() => void submit(true)}>
                {t("autoPageDrawerApprove", "Approve")}
              </Button>
            </>
          ) : (
            <Button variant="primary" busy={busy} disabled={disabled} onClick={() => void submit()}>
              {t("autoPageDrawerReviewResolve", "Review and resolve")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
