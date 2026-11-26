import { useI18n } from "@/i18n";
import { getSealedSessionOrigin, requestAutomationPage } from "@/lib/automation-request";

export function AutomationSealedBanner({ sessionId }: { sessionId: string }) {
  const { t } = useI18n();
  const origin = getSealedSessionOrigin(sessionId);
  return (
    <div className="auto-chat-sealed-dock">
      <section
        className="auto-chat-sealed automation-card chat-content-column"
        aria-label={t("autoChatSealedTitle", "Automation run record · Read-only")}
      >
        <div className="auto-chat-heading-row">
          <h2 className="auto-chat-title type-body-medium">
            {t("autoChatSealedTitle", "Automation run record · Read-only")}
          </h2>
          <span className="automation-badge type-meta-default">
            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor">
              <rect x="3" y="7" width="10" height="7" rx="2" />
              <path d="M5 7V4a3 3 0 0 1 6 0v3M8 10v2" />
            </svg>
            {t("autoChatSealedBadge", "Sealed")}
          </span>
        </div>
        <p className="auto-chat-description type-body-default">
          {t(
            "autoChatSealedDescription",
            "You can view AI thinking and tool calls here. This run record is read-only, so the message composer is hidden.",
          )}
        </p>
        {origin && (
          <dl className="auto-chat-origin type-meta-default">
            <div>
              <dt>{t("autoChatTaskLabel", "Task")}</dt>
              <dd>{origin.taskName || origin.taskId}</dd>
            </div>
            <div>
              <dt>{t("autoChatRunLabel", "Run")}</dt>
              <dd className="type-mono-meta">{origin.runId}</dd>
            </div>
            {origin.stepId && (
              <div>
                <dt>{t("autoChatStepLabel", "Step")}</dt>
                <dd className="type-mono-meta">{origin.stepId}</dd>
              </div>
            )}
          </dl>
        )}
        <div className="automation-actions">
          <button
            type="button"
            className="automation-btn type-label-medium"
            onClick={() =>
              requestAutomationPage(
                origin
                  ? {
                      view: "run",
                      environmentId: origin.environmentId,
                      taskId: origin.taskId,
                      runId: origin.runId,
                    }
                  : { view: "overview" },
              )
            }
          >
            {origin
              ? t("autoChatBackToRun", "Back to run {run}").replace("{run}", origin.runId)
              : t("autoChatBackToOverview", "Automation overview")}
          </button>
        </div>
      </section>
    </div>
  );
}
