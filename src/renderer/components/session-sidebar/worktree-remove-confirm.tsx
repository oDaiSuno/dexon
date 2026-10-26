import { useI18n } from "@/i18n";
import type { MouseEvent as ReactMouseEvent } from "react";

export function WorktreeRemoveConfirm({
  onForce,
  onCancel,
  busy,
}: {
  onForce: (event: ReactMouseEvent) => void;
  onCancel: (event: ReactMouseEvent) => void;
  busy: boolean;
}) {
  const { t } = useI18n();
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 8,
        padding: 8,
        borderRadius: "var(--radius-control)",
        background: "var(--fx-status-danger-soft)",
      }}
    >
      <span
        className="type-meta-default"
        style={{ flex: "1 1 100%", color: "var(--fx-text-primary)", overflowWrap: "anywhere" }}
      >
        {t("worktreeForceRemoveConfirm", "Uncommitted changes. Force remove checkout?")}
      </span>
      <button
        onClick={onForce}
        disabled={busy}
        className="type-label-medium"
        style={{
          marginLeft: "auto",
          padding: "4px 8px",
          background: "var(--fx-status-danger)",
          border: "1px solid transparent",
          borderRadius: "var(--radius-control)",
          color: "var(--fx-text-on-danger)",
          cursor: busy ? "not-allowed" : "pointer",
          flexShrink: 0,
        }}
      >
        {t("force", "Force")}
      </button>
      <button
        onClick={onCancel}
        className="type-label-medium"
        style={{
          padding: "4px 8px",
          background: "var(--fx-surface-card)",
          border: "1px solid var(--fx-line-default)",
          borderRadius: "var(--radius-control)",
          color: "var(--fx-text-secondary)",
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        {t("cancel", "Cancel")}
      </button>
    </div>
  );
}
