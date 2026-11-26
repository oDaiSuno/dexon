import { useI18n } from "@/i18n";
import { useAutomationSessionIntent } from "@/lib/automation-session-intent";

export function AutomationStarterCards({ onFillPrompt }: { onFillPrompt: (prompt: string) => void }) {
  const { t } = useI18n();
  const intent = useAutomationSessionIntent();
  if (!intent || intent.mode === "adjust") return null;
  const cards =
    intent.mode === "draft"
      ? [
          {
            title: t("autoChatStarterDraftScheduleTitle", "Scheduled inspection and notification"),
            prompt: t(
              "autoChatStarterDraftSchedulePrompt",
              "Every weekday at 09:00, inspect the project's recent changes and errors, then send me a concise notification. Report findings only; do not modify files.",
            ),
            path: "M10 4v6l4 2M6 2v2m8-2v2M4 6h12M3 4h14v13H3z",
          },
          {
            title: t("autoChatStarterDraftHealthTitle", "Health monitoring with approval"),
            prompt: t(
              "autoChatStarterDraftHealthPrompt",
              "Check service health every 15 minutes and notify me of anomalies. Propose recovery steps, but require my approval before restarting a service or making changes.",
            ),
            path: "M2 10h4l2-6 4 12 2-6h4",
          },
          {
            title: t("autoChatStarterDraftAuditTitle", "Recurring audit and weekly report"),
            prompt: t(
              "autoChatStarterDraftAuditPrompt",
              "Audit dependencies and configuration risks every week, and send me a report on Friday afternoon. Summarize changes and recommendations without automatically applying fixes.",
            ),
            path: "M5 2h8l3 3v13H4V2h1m8 0v4h3M7 10h6m-6 4h6",
          },
        ]
      : [
          {
            title: t("autoChatStarterModifyScheduleTitle", "Change the schedule"),
            prompt: t(
              "autoChatStarterModifySchedulePrompt",
              "Change this task to run at 09:00 every weekday. Check the time zone and explain how the new schedule differs, then save a new disabled draft for my review.",
            ),
            path: "M10 4v6l4 2M6 2v2m8-2v2M4 6h12M3 4h14v13H3z",
          },
          {
            title: t("autoChatStarterModifySkipTitle", "Add a skip condition"),
            prompt: t(
              "autoChatStarterModifySkipPrompt",
              "Skip this task when there are no new changes since its last successful run. Keep the current approval boundaries and save a new disabled draft for my review.",
            ),
            path: "M3 4h14l-5 6v5l-4 2v-7L3 4Z",
          },
          {
            title: t("autoChatStarterModifyFailuresTitle", "Diagnose recent failures"),
            prompt: t(
              "autoChatStarterModifyFailuresPrompt",
              "Review this task's recent failed runs and explain the likely causes. Suggest the smallest safe fix and save any proposed changes as a new disabled draft for my review.",
            ),
            path: "m13 13 4 4M15 8a6 6 0 1 1-12 0 6 6 0 0 1 12 0ZM9 5v4m0 2h.01",
          },
        ];
  return (
    <section className="auto-chat-starters" aria-label={t("autoChatStarterLabel", "Try a starting point")}>
      {cards.map((card) => (
        <button key={card.title} type="button" className="auto-chat-starter" onClick={() => onFillPrompt(card.prompt)}>
          <span className="auto-chat-starter-heading type-label-medium">
            <svg
              aria-hidden="true"
              width="16"
              height="16"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d={card.path} />
            </svg>
            {card.title}
          </span>
          <span className="auto-chat-starter-description type-meta-default">{card.prompt}</span>
        </button>
      ))}
    </section>
  );
}
