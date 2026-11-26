import { useId, useRef, useState, type FormEvent } from "react";
import type { EnvironmentId } from "@contract/environment";
import type { Json, SignalWaitSpec } from "@shared/automation/spec";
import type { RunDetailView, StepView } from "@shared/automation/views";
import { useI18n } from "@/i18n";
import { Button } from "../form-controls";
import { useAutomationWorkspace } from "./automation-context";
import { AutomationIcon } from "./automation-icons";
import { errorMessage, signalWaitTarget } from "./run-values";

export function AutomationSignalAction({
  environmentId,
  run,
  wait,
  record,
  taskName,
  onSent,
}: {
  environmentId: EnvironmentId;
  run: RunDetailView;
  wait: SignalWaitSpec;
  record: StepView;
  taskName: string;
  onSent?: () => void;
}) {
  const { t } = useI18n();
  const { call, hosts, notify } = useAutomationWorkspace();
  const [expanded, setExpanded] = useState(false);
  const [payload, setPayload] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const receipt = useRef<{ digest: string; eventId: string } | null>(null);
  const payloadId = useId();
  const errorId = useId();
  const target = signalWaitTarget(wait, record, run, taskName);
  const online = hosts.some((host) => host.environment.id === environmentId && host.status === "online");
  const active =
    run.phase === "waiting" &&
    record.status === "waiting" &&
    record.waitKind === "signal" &&
    (record.expiresAtMs === null || record.expiresAtMs > Date.now());

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting.current || sent || !online || !active || target.key === null) return;
    let value: Json;
    try {
      value = payload.trim()
        ? (JSON.parse(payload, (_, item: unknown) => {
            if (typeof item === "number" && !Number.isFinite(item)) throw new Error("invalid_json");
            return item;
          }) as Json)
        : null;
    } catch {
      setError(t("autoPageRunSignalInvalidJson", "Enter valid JSON, or leave the payload empty."));
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const request = { taskId: run.taskId, name: target.name, key: target.key, payload: value };
      const digest = JSON.stringify(request);
      if (receipt.current?.digest !== digest) receipt.current = { digest, eventId: crypto.randomUUID() };
      const result = await call(environmentId, "automation.emitSignal", {
        ...request,
        eventId: receipt.current.eventId,
      });
      setSent(true);
      notify(t("autoPageRunSignalSent", "Signal sent. Runs resumed:") + " " + result.woke);
      onSent?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <section className="auto-page-signal-action">
      <div className="auto-page-run-inline-heading type-body-medium">
        <AutomationIcon name="clock" />
        {t("autoPageRunSignalWaiting", "Waiting for an external signal")}
      </div>
      <dl className="auto-page-run-facts type-label-default">
        <div>
          <dt>{t("autoPageRunSignalName", "Signal")}</dt>
          <dd className="type-mono-label">{target.name}</dd>
        </div>
        <div>
          <dt>{t("autoPageRunSignalKey", "Matching key")}</dt>
          <dd className="type-mono-label">{target.key ?? t("autoPageRunSignalKeyMissing", "Key unavailable")}</dd>
        </div>
      </dl>
      {target.key === null && (
        <p className="auto-page-run-notice type-label-default">
          {t(
            "autoPageRunSignalUnresolved",
            "The matching key could not be resolved. Refresh the run before sending a signal.",
          )}
        </p>
      )}
      {!expanded && !sent && (
        <Button disabled={!online || !active || target.key === null} onClick={() => setExpanded(true)}>
          <AutomationIcon name="play" />
          {t("autoPageRunSignalManual", "Send signal manually")}
        </Button>
      )}
      {sent && (
        <p role="status" className="auto-page-run-notice type-label-default" data-tone="success">
          {t("autoPageRunSignalAccepted", "Signal accepted. The timeline will update automatically.")}
        </p>
      )}
      {expanded && !sent && (
        <form onSubmit={(event) => void send(event)} className="auto-page-run-form">
          <p className="auto-page-run-muted type-label-default">
            {t(
              "autoPageRunSignalScope",
              "This signal can resume every waiting run of this task with the same signal name and key.",
            )}
          </p>
          <label htmlFor={payloadId} className="type-label-medium">
            {t("autoPageRunSignalPayload", "Payload JSON (optional)")}
          </label>
          <textarea
            id={payloadId}
            className="ui-input auto-page-json-input type-mono-code"
            rows={5}
            spellCheck={false}
            value={payload}
            disabled={busy || !online || !active}
            onChange={(event) => {
              setPayload(event.target.value);
              setError(null);
            }}
            placeholder={t("autoPageRunSignalPayloadPlaceholder", "null")}
            aria-invalid={!!error}
            aria-describedby={error ? errorId : undefined}
          />
          {error && (
            <p id={errorId} role="alert" className="auto-page-run-error type-label-default">
              {error}
            </p>
          )}
          <div className="auto-page-run-actions">
            <Button disabled={busy} onClick={() => setExpanded(false)}>
              {t("autoPageRunSignalDismiss", "Dismiss")}
            </Button>
            <Button
              type="submit"
              variant="primary"
              busy={busy}
              disabled={busy || !online || !active || target.key === null}
            >
              {busy ? t("autoPageRunSignalSending", "Sending…") : t("autoPageRunSignalSend", "Send signal")}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
