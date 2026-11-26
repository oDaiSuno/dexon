import { useI18n } from "@/i18n";
import type { AutomationAiSessionIntent } from "@/lib/automation-request";

export function AutomationWelcome({ intent }: { intent: AutomationAiSessionIntent }) {
  const { t } = useI18n();
  const title =
    intent.mode === "draft"
      ? t("autoChatDraftWelcomeTitle", "Describe what you want to automate in the background")
      : intent.mode === "modify"
        ? t("autoChatModifyWelcomeTitle", "Tell AI how you want to change this task")
        : t("autoChatAdjustWelcomeTitle", "Ask AI to keep refining the current workflow");
  return (
    <div className="auto-chat-welcome" data-mode={intent.mode}>
      <span className="automation-badge is-accent type-meta-default">
        <svg
          aria-hidden="true"
          width="14"
          height="14"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m10 2 2.2 5.8L18 10l-5.8 2.2L10 18l-2.2-5.8L2 10l5.8-2.2L10 2Z" />
        </svg>
        {t("autoChatWelcomeBadge", "Automation assistant")}
      </span>
      <h1 className="auto-chat-welcome-title type-title-section">{title}</h1>
      {intent.mode === "draft" ? (
        <p className="auto-chat-description type-body-relaxed">
          {t(
            "autoChatDraftWelcomeDescription",
            "Describe the trigger, steps, and approval boundaries in natural language. AI will validate and save a disabled draft first; you review it and make the final decision.",
          )}
        </p>
      ) : (
        <>
          <div className="auto-chat-environment" role="status">
            <span className="automation-badge is-success type-meta-default">
              {t("autoChatEnvironmentSwitched", "Environment switched")}
            </span>
            <span className="type-label-medium">{intent.environmentLabel}</span>
            <span className="auto-chat-path type-mono-meta">{intent.cwd}</span>
          </div>
          {intent.mode === "adjust" && intent.hasUnsavedChanges && (
            <p className="automation-notice auto-chat-dirty-notice type-body-default">
              {t(
                "autoChatUnsavedSnapshotNotice",
                "A snapshot of unsaved local workflow edits is attached. It will not overwrite the existing revision; any new AI draft takes effect only after your review.",
              )}
            </p>
          )}
        </>
      )}
    </div>
  );
}
