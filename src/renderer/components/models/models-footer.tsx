import { Button } from "../form-controls";
import { useI18n } from "@/i18n";

export function TrashIcon() {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
      <line x1="10" x2="10" y1="11" y2="17" />
      <line x1="14" x2="14" y1="11" y2="17" />
    </svg>
  );
}

export function DialogFooter({
  padding,
  deleteLabel,
  onDelete,
  onCancel,
  onSave,
  saving,
  deleting = false,
  saveDisabled,
  cancelLabel,
}: {
  padding: string;
  deleteLabel?: string;
  onDelete?: () => void;
  onCancel: () => void;
  onSave?: () => void;
  saving: boolean;
  deleting?: boolean;
  saveDisabled?: boolean;
  cancelLabel?: string;
}) {
  const { t } = useI18n();
  return (
    <footer
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding,
        borderTop: "1px solid var(--fx-line-default)",
        background: "var(--fx-surface-raised)",
        flexShrink: 0,
      }}
    >
      {deleteLabel && onDelete && (
        <Button variant="ghost" onClick={onDelete} disabled={saving || deleting} busy={deleting}>
          <TrashIcon />
          {deleting ? t("modelRemoving", "Removing…") : deleteLabel}
        </Button>
      )}
      <span style={{ flex: 1 }} />
      <Button variant="ghost" onClick={onCancel} disabled={saving || deleting}>
        {cancelLabel ?? t("cancel", "Cancel")}
      </Button>
      {onSave && (
        <Button variant="primary" onClick={onSave} disabled={saving || deleting || saveDisabled} busy={saving}>
          {saving ? t("saving", "Saving…") : t("save", "Save")}
        </Button>
      )}
    </footer>
  );
}
