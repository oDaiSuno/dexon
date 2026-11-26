import { useState } from "react";
import type { EnvironmentId } from "@contract/environment";
import type { AutomationChatCard } from "@shared/automation/chat-tools";
import type { Json } from "@shared/automation/spec";
import { useI18n } from "@/i18n";
import { requestAutomationPage } from "@/lib/automation-request";
import { getEnvironmentConnection } from "@/lib/environment-registry";

export function OpenInAutomationButton({
  environmentId,
  taskId,
  runId,
}: {
  environmentId: EnvironmentId;
  taskId: string;
  runId?: string;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className="automation-btn type-label-medium"
      onClick={() =>
        requestAutomationPage(
          runId ? { view: "run", environmentId, taskId, runId } : { view: "task", environmentId, taskId },
        )
      }
    >
      {t("autoChatOpenInAutomation", "Open in Automations")}
    </button>
  );
}

export function parseOptionalJsonOutput(raw: string): { ok: true; value?: Json } | { ok: false } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true };
  try {
    return { ok: true, value: JSON.parse(trimmed) as Json };
  } catch {
    return { ok: false };
  }
}

export function AutomationAttentionOutputField({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="automation-section">
      <label className="automation-section-title type-meta-caps">
        {t("autoChatAttentionOutputLabel", "Optional step output JSON (for downstream steps)")}
      </label>
      <textarea
        className="automation-textarea type-mono-code"
        value={value}
        placeholder={t("autoChatAttentionOutputPlaceholder", '{"ok": true}')}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
      />
    </div>
  );
}

export function EmitSignalSubCard({
  environmentId,
  card,
  makeRequestId,
}: {
  environmentId: EnvironmentId;
  card: Extract<AutomationChatCard, { kind: "emit_signal" }>;
  makeRequestId: (prefix: string) => string;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);

  const sendSignal = async () => {
    setBusy(true);
    setError(null);
    try {
      const connection = getEnvironmentConnection(environmentId);
      const { woke } = await connection.call("automation.emitSignal", {
        taskId: card.taskId,
        name: card.signalName,
        key: card.signalKey,
        eventId: makeRequestId("chat-signal"),
        payload: card.payload,
      });
      setStatusText(t("automationCardSignalSent", "Signal sent ({count} woken)").replace("{count}", String(woke)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`automation-card${statusText ? " is-settled" : ""}`}>
      <div className="automation-card-head">
        <div className="automation-card-heading">
          <span className="automation-card-kicker type-meta-caps">
            {t("automationCardSignalTitle", "Send signal to automation")}
          </span>
          <span className="automation-card-title type-heading">{card.taskName}</span>
          <p className="automation-card-subtitle type-body-default">{card.reason}</p>
        </div>
        <span className="automation-badge type-mono-meta">
          {t("automationCardSignalMeta", "Signal {name} · key {key}")
            .replace("{name}", card.signalName)
            .replace("{key}", card.signalKey)}
        </span>
      </div>
      {card.payload !== null && (
        <pre className="automation-pre type-mono-code">{JSON.stringify(card.payload, null, 2)}</pre>
      )}
      {statusText && <div className="automation-notice is-success type-label-default">{statusText}</div>}
      {error && <p className="automation-error type-label-default">{error}</p>}
      <div className="automation-actions">
        <OpenInAutomationButton environmentId={environmentId} taskId={card.taskId} />
        {!statusText && (
          <button
            type="button"
            className="automation-btn is-primary type-label-medium"
            disabled={busy}
            onClick={() => void sendSignal()}
          >
            {t("automationCardSignalSend", "Send signal")}
          </button>
        )}
      </div>
    </section>
  );
}
