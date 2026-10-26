import { useI18n } from "@/i18n";
import { Toggle } from "../form-controls";

export function SkillToggle({
  enabled,
  loading,
  onToggle,
  className,
}: {
  enabled: boolean;
  loading: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <Toggle
      className={className}
      checked={enabled}
      aria-checked={enabled}
      disabled={loading}
      onChange={onToggle}
      aria-label={
        enabled
          ? t("disableSkillInModelPrompt", "Disable skill in model prompt")
          : t("enableSkillInModelPrompt", "Enable skill in model prompt")
      }
      title={
        enabled
          ? t("visibleSkillInModelPrompt", "Visible in model prompt — click to disable")
          : t("hiddenSkillFromModelPrompt", "Hidden from model prompt — click to enable")
      }
    />
  );
}
