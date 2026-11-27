import { useI18n } from "@/i18n";
import type { AutomationAiSessionIntent } from "@/lib/automation-request";
import appIconUrl from "../../../../build/icon.png";

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
      <div className="auto-chat-welcome-row">
        <img src={appIconUrl} alt="" aria-hidden="true" className="auto-chat-welcome-icon" />
        <h1 className="auto-chat-welcome-title type-title-section">{title}</h1>
      </div>
      {intent.mode === "draft" ? (
        <p className="auto-chat-description type-body-default">
          {t(
            "autoChatDraftWelcomeDescription",
            "Describe the trigger, steps, and approval boundaries in natural language. AI will validate and save a disabled draft first; you review it and make the final decision.",
          )}
        </p>
      ) : intent.mode === "modify" ? (
        <div className="auto-chat-environment type-label-medium" role="status">
          <span className="auto-chat-env-dot" aria-hidden="true" />
          <span>
            {t("autoChatEnvironmentSwitched", "Environment switched")}：{intent.environmentLabel}
            {intent.cwd ? ` · ${intent.cwd}` : ""}
          </span>
        </div>
      ) : (
        intent.hasUnsavedChanges && (
          <p className="auto-chat-dirty-notice type-meta-default" role="status">
            <svg
              aria-hidden="true"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m12 3 10 18H2ZM12 9v4" />
              <path d="M12 17h.01" />
            </svg>
            <span>
              {t(
                "autoChatUnsavedSnapshotNotice",
                "A snapshot of unsaved local workflow edits is attached. It will not overwrite the existing revision; any new AI draft takes effect only after your review.",
              )}
            </span>
          </p>
        )
      )}
    </div>
  );
}
