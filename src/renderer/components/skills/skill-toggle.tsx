import { useI18n } from "@/i18n";

export function SkillToggle({
  enabled,
  loading,
  onToggle,
}: {
  enabled: boolean;
  loading: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={
        enabled
          ? t("disableSkillInModelPrompt", "Disable skill in model prompt")
          : t("enableSkillInModelPrompt", "Enable skill in model prompt")
      }
      onClick={onToggle}
      disabled={loading}
      title={
        enabled
          ? t("visibleSkillInModelPrompt", "Visible in model prompt — click to disable")
          : t("hiddenSkillFromModelPrompt", "Hidden from model prompt — click to enable")
      }
      style={{
        flexShrink: 0,
        width: 48,
        height: 32,
        borderRadius: "var(--radius-pill)",
        border: "none",
        padding: 0,
        cursor: loading ? "wait" : "pointer",
        background: enabled ? "var(--accent)" : "var(--border)",
        position: "relative",
        transition: "background 0.18s",
        outline: "none",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 6,
          left: enabled ? 25 : 5,
          width: 20,
          height: 20,
          borderRadius: "50%",
          background: "var(--bg)",
          boxShadow: "0 1px 4px rgba(0,0,0,0.22)",
          transition: "left 0.18s cubic-bezier(.4,0,.2,1)",
        }}
      />
    </button>
  );
}
