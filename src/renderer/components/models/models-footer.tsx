import { useI18n } from "@/i18n";

export function ModelsFooter({
  embedded,
  loading,
  saving,
  savedOk,
  saveError,
  saveConflict,
  loadFailed,
  configLoaded,
  configVersion,
  loadModelsConfig,
  onClose,
  handleSave,
}: {
  embedded: boolean;
  loading: boolean;
  saving: boolean;
  savedOk: boolean;
  saveError: string | null;
  saveConflict: boolean;
  loadFailed: boolean;
  configLoaded: boolean;
  configVersion: string | null;
  loadModelsConfig: () => Promise<void>;
  onClose: () => void;
  handleSave: () => Promise<void>;
}) {
  const { t } = useI18n();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: 12,
        padding: "12px 20px",
        borderTop: "1px solid var(--fx-line-default)",
        flexShrink: 0,
      }}
    >
      {saveError && (
        <span style={{ fontSize: "var(--text-label)", color: "var(--fx-status-danger)", flex: 1 }}>{saveError}</span>
      )}
      {saveConflict && (
        <button
          type="button"
          onClick={() => void loadModelsConfig()}
          disabled={loading || saving}
          title={t("modelReloadDiskVersionHint", "Discard local edits and load the current models.json")}
          style={{
            padding: "8px 12px",
            background: "none",
            border: "1px solid var(--fx-line-default)",
            borderRadius: "var(--radius-control)",
            color: "var(--fx-text-primary)",
            cursor: loading || saving ? "default" : "pointer",
            fontSize: "var(--text-label)",
          }}
        >
          {t("modelReloadDiskVersion", "Reload disk version")}
        </button>
      )}
      {!embedded && (
        <button
          onClick={onClose}
          style={{
            padding: "8px 16px",
            background: "none",
            border: "1px solid var(--fx-line-default)",
            borderRadius: "var(--radius-control)",
            color: "var(--fx-text-secondary)",
            cursor: "pointer",
            fontSize: "var(--text-body)",
          }}
        >
          {t("cancel", "Cancel")}
        </button>
      )}
      <button
        onClick={handleSave}
        disabled={saving || savedOk || loading || loadFailed || saveConflict || !configLoaded || !configVersion}
        title={loadFailed ? t("modelCannotSaveBeforeLoad", "Cannot save until config loads successfully") : undefined}
        style={{
          position: "relative",
          padding: "8px 16px",
          minWidth: 92,
          background: savedOk
            ? "var(--fx-status-success-soft)"
            : saving || loadFailed || saveConflict || !configLoaded || !configVersion
              ? "var(--fx-surface-raised)"
              : "var(--fx-accent-blue)",
          border: "none",
          borderRadius: "var(--radius-control)",
          color: savedOk
            ? "var(--fx-status-success)"
            : !(saving || loadFailed || saveConflict || !configLoaded || !configVersion)
              ? "var(--fx-text-on-accent)"
              : "var(--fx-text-secondary)",
          cursor:
            saving || savedOk || loading || loadFailed || saveConflict || !configLoaded || !configVersion
              ? "default"
              : "pointer",
          fontSize: "var(--text-body)",
          fontWeight: 600,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          transition: "background-color 0.2s ease, color 0.2s ease",
          animation: savedOk ? "saved-pop 0.45s ease" : undefined,
        }}
      >
        {savedOk && (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ strokeDasharray: 18, animation: "saved-check-draw 0.35s ease forwards", flexShrink: 0 }}
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
        <span>{savedOk ? t("saved", "Saved") : saving ? t("saving", "Saving…") : t("save", "Save")}</span>
      </button>
    </div>
  );
}
