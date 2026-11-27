import { useI18n } from "@/i18n";
import { useAutomationSessionIntent } from "@/lib/automation-session-intent";

export function AutomationStarterCards({ onFillPrompt }: { onFillPrompt: (prompt: string) => void }) {
  const { t } = useI18n();
  const intent = useAutomationSessionIntent();
  if (!intent) return null;

  if (intent.mode === "adjust") {
    return (
      <p className="auto-chat-footer-hint type-meta-default">
        {t(
          "autoChatAdjustFooterHint",
          "If the target remote host is offline, reconnect first before asking AI to modify; new unsaved tasks default to Local when no remote host is chosen.",
        )}
      </p>
    );
  }

  const isDraft = intent.mode === "draft";
  const cards = isDraft
    ? [
        {
          title: t("autoChatStarterDraftScheduleTitle", "Scheduled inspection and notification"),
          prompt: t(
            "autoChatStarterDraftSchedulePrompt",
            "Every weekday at 09:00, inspect the project's recent changes and errors, then send me a concise notification. Report findings only; do not modify files.",
          ),
          tone: "accent" as const,
          path: "M10 4v6l4 2M6 2v2m8-2v2M4 6h12M3 4h14v13H3z",
        },
        {
          title: t("autoChatStarterDraftHealthTitle", "Health monitoring with approval"),
          prompt: t(
            "autoChatStarterDraftHealthPrompt",
            "Check service health every 15 minutes and notify me of anomalies. Propose recovery steps, but require my approval before restarting a service or making changes.",
          ),
          tone: "danger" as const,
          path: "M2 10h4l2-6 4 12 2-6h4",
        },
        {
          title: t("autoChatStarterDraftAuditTitle", "Recurring audit and weekly report"),
          prompt: t(
            "autoChatStarterDraftAuditPrompt",
            "Audit dependencies and configuration risks every week, and send me a report on Friday afternoon. Summarize changes and recommendations without automatically applying fixes.",
          ),
          tone: "success" as const,
          path: "M10 2 4 5v5c0 4 2.7 6.8 6 8 3.3-1.2 6-4 6-8V5l-6-3Zm-2.5 8.2 1.8 1.8 3.4-3.6",
        },
      ]
    : [
        {
          title: t("autoChatStarterModifyScheduleTitle", "Change the schedule"),
          prompt: t(
            "autoChatStarterModifySchedulePrompt",
            "Change this task to run at 09:00 every weekday. Check the time zone and explain how the new schedule differs, then save a new disabled draft for my review.",
          ),
          tone: "accent" as const,
          path: "",
        },
        {
          title: t("autoChatStarterModifySkipTitle", "Add a skip condition"),
          prompt: t(
            "autoChatStarterModifySkipPrompt",
            "Skip this task when there are no new changes since its last successful run. Keep the current approval boundaries and save a new disabled draft for my review.",
          ),
          tone: "accent" as const,
          path: "",
        },
        {
          title: t("autoChatStarterModifyFailuresTitle", "Diagnose recent failures"),
          prompt: t(
            "autoChatStarterModifyFailuresPrompt",
            "Review this task's recent failed runs and explain the likely causes. Suggest the smallest safe fix and save any proposed changes as a new disabled draft for my review.",
          ),
          tone: "accent" as const,
          path: "",
        },
      ];

  const sectionLabel = isDraft
    ? t("autoChatStarterDraftLabel", "Try starting with one sentence (click to fill the input)")
    : t("autoChatStarterModifyLabel", "Common modification prompts");

  return (
    <div className="auto-chat-starters-wrap">
      <span className="auto-chat-starters-label type-meta-default">{sectionLabel}</span>
      <section className="auto-chat-starters" aria-label={sectionLabel}>
        {cards.map((card) => (
          <button
            key={card.title}
            type="button"
            className={`auto-chat-starter${isDraft ? "" : " is-compact"}`}
            data-tone={card.tone}
            onClick={() => onFillPrompt(card.prompt)}
          >
            {isDraft && (
              <span className="auto-chat-starter-heading type-label-medium">
                <svg
                  aria-hidden="true"
                  width="14"
                  height="14"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d={card.path} />
                </svg>
                {card.title}
              </span>
            )}
            <span className="auto-chat-starter-description type-body-default">{card.prompt}</span>
          </button>
        ))}
      </section>
      {isDraft && (
        <p className="auto-chat-footer-hint type-meta-default">
          {t(
            "autoChatDraftFooterHint",
            "After sending, this conversation is saved under Automation space so you can return anytime · Jump straight back to Automation once AI saves a draft",
          )}
        </p>
      )}
    </div>
  );
}
