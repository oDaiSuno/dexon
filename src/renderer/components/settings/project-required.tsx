import { useI18n } from "@/i18n";

export function ProjectRequired() {
  const { t } = useI18n();
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 28,
        textAlign: "center",
      }}
    >
      <div style={{ maxWidth: 380 }}>
        <div style={{ fontSize: "var(--text-body-lg)", fontWeight: 650, color: "var(--text)" }}>
          {t("projectRequiredTitle", "Select a project first")}
        </div>
        <div style={{ marginTop: 8, fontSize: "var(--text-label)", lineHeight: 1.6, color: "var(--text-dim)" }}>
          {t(
            "projectRequiredDescription",
            "Skills and plugins depend on the current project. Select a project directory from the sidebar first.",
          )}
        </div>
      </div>
    </div>
  );
}
