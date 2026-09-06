import { useI18n } from "@/i18n";
import type { MouseEvent as ReactMouseEvent } from "react";

// Split from worktree-switcher.tsx in Phase 2: the inline force-remove
// confirmation row shown inside the worktree dropdown.

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
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        borderBottom: "1px solid var(--border)",
        background: "rgba(239,68,68,0.06)",
      }}
    >
      <span
        style={{
          flex: 1,
          fontSize: "var(--text-meta)",
          color: "var(--text)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {t("worktreeForceRemoveConfirm", "Uncommitted changes. Force remove checkout?")}
      </span>
      <button
        onClick={onForce}
        disabled={busy}
        style={{
          padding: "4px 8px",
          background: "var(--danger)",
          border: "none",
          borderRadius: "var(--radius-control)",
          color: "var(--on-danger)",
          fontSize: "var(--text-meta)",
          fontWeight: 600,
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        {t("force", "Force")}
      </button>
      <button
        onClick={onCancel}
        style={{
          padding: "4px 8px",
          background: "var(--bg-hover)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-control)",
          color: "var(--text-muted)",
          fontSize: "var(--text-meta)",
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        {t("cancel", "Cancel")}
      </button>
    </div>
  );
}
