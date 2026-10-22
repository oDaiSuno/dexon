import { Button } from "../form-controls";
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
  const blocked = saving || loadFailed || saveConflict || !configLoaded || !configVersion;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: 8,
        padding: "var(--space-3) var(--space-6)",
        borderTop: "1px solid var(--fx-line-default)",
        background: "var(--fx-surface-raised)",
        flexShrink: 0,
      }}
    >
      {saveError && (
        <span className="type-label-default" style={{ color: "var(--fx-status-danger)", flex: 1 }}>
          {saveError}
        </span>
      )}
      {saveConflict && (
        <Button
          onClick={() => void loadModelsConfig()}
          disabled={loading || saving}
          title={t("modelReloadDiskVersionHint", "Discard local edits and load the current models.json")}
        >
          {t("modelReloadDiskVersion", "Reload disk version")}
        </Button>
      )}
      {!embedded && <Button onClick={onClose}>{t("cancel", "Cancel")}</Button>}
      <Button
        variant={savedOk || blocked ? "secondary" : "primary"}
        onClick={handleSave}
        disabled={saving || savedOk || loading || loadFailed || saveConflict || !configLoaded || !configVersion}
        title={loadFailed ? t("modelCannotSaveBeforeLoad", "Cannot save until config loads successfully") : undefined}
        style={{
          position: "relative",
          minWidth: 92,
          ...(savedOk
            ? {
                opacity: 1,
                borderColor: "var(--fx-status-success-border)",
                background: "var(--fx-status-success-soft)",
                color: "var(--fx-status-success-text)",
              }
            : {}),
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
            style={{
              color: "currentColor",
              strokeDasharray: 18,
              animation: "saved-check-draw 0.35s ease forwards",
              flexShrink: 0,
            }}
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
        <span>{savedOk ? t("saved", "Saved") : saving ? t("saving", "Saving…") : t("save", "Save")}</span>
      </Button>
    </div>
  );
}
