import { useI18n } from "@/i18n";

const leavePromptButtonStyle: React.CSSProperties = {
  minHeight: 34,
  padding: "8px 12px",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-control)",
  background: "var(--bg-panel)",
  color: "var(--text-muted)",
  cursor: "pointer",
  fontSize: "var(--text-label)",
};

export function UnsavedSkillPrompt({
  saving,
  onDiscard,
  onCancel,
  onSave,
}: {
  saving: boolean;
  onDiscard: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      role="presentation"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 2,
        display: "grid",
        placeItems: "center",
        padding: 16,
        background: "rgba(0,0,0,0.35)",
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !saving) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="unsaved-skill-title"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !saving) {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
        style={{
          width: 420,
          maxWidth: "100%",
          padding: 20,
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-card)",
          background: "var(--bg)",
          boxShadow: "0 16px 48px rgba(0,0,0,0.3)",
        }}
      >
        <h3 id="unsaved-skill-title" style={{ margin: 0, fontSize: "var(--text-body-lg)", color: "var(--text)" }}>
          {t("unsavedSkillChanges", "Unsaved skill changes")}
        </h3>
        <p
          style={{
            margin: "8px 0 16px",
            fontSize: "var(--text-label)",
            lineHeight: 1.55,
            color: "var(--text-muted)",
          }}
        >
          {t("unsavedSkillChangesDescription", "Save your SKILL.md changes before leaving this editor?")}
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" disabled={saving} onClick={onDiscard} style={leavePromptButtonStyle}>
            {t("discard", "Discard")}
          </button>
          <button type="button" disabled={saving} onClick={onCancel} style={leavePromptButtonStyle}>
            {t("cancel", "Cancel")}
          </button>
          <button
            type="button"
            disabled={saving}
            aria-label={t("save", "Save")}
            aria-busy={saving || undefined}
            onClick={() => void onSave()}
            style={{
              ...leavePromptButtonStyle,
              borderColor: "transparent",
              background: "var(--btn-bg)",
              color: "var(--btn-fg)",
            }}
          >
            {saving ? t("saving", "Saving…") : t("save", "Save")}
          </button>
        </div>
      </div>
    </div>
  );
}
