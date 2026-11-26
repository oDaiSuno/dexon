import type { AutomationPromptBadge } from "@shared/automation/prompt-context";
import { useI18n } from "@/i18n";

export function AutomationPromptPill({ badge }: { badge: AutomationPromptBadge }) {
  const { t } = useI18n();
  const title =
    badge.mode === "draft"
      ? t("autoChatPillDraft", "Automation task draft")
      : badge.mode === "modify"
        ? t("autoChatPillModify", "Modify task: {task}").replace("{task}", badge.taskName ?? badge.taskId ?? "")
        : t("autoChatPillAdjust", "Adjust draft snapshot: {task}").replace(
            "{task}",
            badge.taskName ?? badge.taskId ?? "",
          );

  return (
    <div className="automation-prompt-pill type-label-medium">
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        aria-hidden="true"
      >
        <path d="m13 2-9 12h7l-1 8 10-12h-7l1-8Z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>{title}</span>
      {badge.revision !== undefined && <span className="type-mono-meta">· v{badge.revision}</span>}
      {badge.environmentLabel && <span className="automation-prompt-pill-host">({badge.environmentLabel})</span>}
      {badge.hasUnsavedChanges && (
        <span className="automation-badge is-warning type-meta-default">
          {t("autoChatPillUnsaved", "Includes unsaved changes")}
        </span>
      )}
    </div>
  );
}
