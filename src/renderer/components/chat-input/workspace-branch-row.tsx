import { useState } from "react";
import { useI18n } from "@/i18n";
import { PathLabel } from "../session-sidebar/path-label";
import { WorktreeRemoveConfirm } from "../session-sidebar/worktree-remove-confirm";
import { CheckmarkIcon, TriangleAlertIcon } from "./icons";
import { CLEAR, QUICK } from "./menu-chrome";
import type { ComposerCardBranch, ComposerWorkspaceCard } from "./types";
import { ELLIPSIS, GLYPH, GitBranchGlyph, HOVER_OVERLAY, HOVER_OVERLAY_STRONG, OUTLINE_NONE } from "./workspace-chrome";
import { FolderGitGlyph, GitCommitGlyph, TrashGlyph, UnlinkGlyph } from "./workspace-glyphs";

function BranchGlyph({ row }: { row: ComposerCardBranch }) {
  if (row.identity === "worktree") return <FolderGitGlyph size={15} />;
  if (row.identity === "detached") return <GitCommitGlyph size={15} />;
  if (row.identity === "stale") return <UnlinkGlyph size={15} />;
  return <GitBranchGlyph size={15} />;
}

function rowNote(row: ComposerCardBranch, t: (key: string, fallback: string) => string): string | null {
  switch (row.identity) {
    case "worktree":
      return null;
    case "detached":
      return t("detachedNote", "Not on any branch");
    case "stale":
      return t("staleNote", "Still registered to missing folder");
    case "branch":
      return t("mainBranch", "Main folder");
  }
}

export function BranchRow({
  row,
  card,
  active,
  onActivate,
  onFocusRow,
}: {
  row: ComposerCardBranch;
  card: ComposerWorkspaceCard;
  active: boolean;
  onActivate: (key: string) => void;
  onFocusRow: (key: string) => void;
}) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState(false);
  const removeHint = t("removeWorktreeHint", "Remove worktree checkout {path}; the branch is kept");
  const folder = row.removable ? row.path : null;
  if (folder && card.confirmRemovePath === folder) {
    return (
      <WorktreeRemoveConfirm
        busy={card.busy}
        onForce={() => card.removeCheckout(folder, true)}
        onCancel={card.cancelRemove}
      />
    );
  }
  const showsRemove = folder !== null;
  const note = rowNote(row, t);
  const hasSubline = row.kind !== "local";
  const faint = row.kind === "stale";
  return (
    <div
      style={{ position: "relative", display: "flex", alignItems: "center" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        aria-label={row.name}
        aria-current={row.kind === "current" ? "true" : undefined}
        aria-disabled={row.disabled ? "true" : undefined}
        disabled={row.disabled}
        title={row.path ?? undefined}
        tabIndex={active ? 0 : -1}
        data-workspace-row="branch"
        data-workspace-key={row.key}
        onFocus={() => onFocusRow(row.key)}
        onClick={() => onActivate(row.key)}
        style={{
          ...OUTLINE_NONE,
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          minHeight: hasSubline ? 46 : 32,
          flexShrink: 0,
          boxSizing: "border-box",
          padding: `0 ${showsRemove ? 30 : 8}px 0 8px`,
          border: "none",
          borderRadius: "var(--radius-control)",
          background: active ? HOVER_OVERLAY_STRONG : hovered && !row.disabled ? HOVER_OVERLAY : CLEAR,
          textAlign: "left",
          cursor: row.disabled ? "default" : "pointer",
          transition: `background ${QUICK}`,
        }}
      >
        <span
          style={{
            ...GLYPH,
            color: faint
              ? "var(--fx-text-faint)"
              : row.kind === "current"
                ? "var(--fx-text-primary)"
                : "var(--fx-text-secondary)",
          }}
        >
          <BranchGlyph row={row} />
        </span>
        <span style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
          <span
            className="type-mono-label"
            style={{ ...ELLIPSIS, color: faint ? "var(--fx-text-tertiary)" : "var(--fx-text-primary)" }}
          >
            {row.name}
          </span>
          {hasSubline && (
            <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
              {note && (
                <span
                  className="type-meta-default"
                  style={{
                    flexShrink: 0,
                    color: faint ? "var(--fx-text-tertiary)" : "var(--fx-text-secondary)",
                  }}
                >
                  {note}
                </span>
              )}
              {row.path && (
                <PathLabel
                  text={row.pathLabel ?? row.path}
                  className="type-mono-meta"
                  style={{ flex: 1, minWidth: 0, color: "var(--fx-text-tertiary)" }}
                />
              )}
            </span>
          )}
        </span>
        {row.blocked ? (
          <span style={{ ...GLYPH, color: "var(--fx-status-warning)" }}>
            <TriangleAlertIcon size={14} />
          </span>
        ) : row.kind === "current" ? (
          <span style={{ ...GLYPH, color: "var(--fx-accent-blue-text)" }}>
            <CheckmarkIcon size={14} />
          </span>
        ) : (
          row.timeLabel && (
            <span className="type-mono-meta" style={{ flexShrink: 0, color: "var(--fx-text-tertiary)" }}>
              {row.timeLabel}
            </span>
          )
        )}
      </button>
      {folder && (
        <button
          type="button"
          onClick={() => card.removeCheckout(folder, false)}
          disabled={card.busy}
          aria-label={removeHint.replace("{path}", folder)}
          title={removeHint.replace("{path}", folder)}
          tabIndex={-1}
          style={{
            ...OUTLINE_NONE,
            position: "absolute",
            right: 4,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 24,
            height: 24,
            padding: 0,
            border: "none",
            borderRadius: "var(--radius-chip)",
            background: HOVER_OVERLAY,
            color: "var(--fx-text-secondary)",
            cursor: card.busy ? "not-allowed" : "pointer",
            opacity: hovered || active ? 1 : 0,
            pointerEvents: hovered || active ? "auto" : "none",
            transition: `opacity ${QUICK}`,
          }}
        >
          <TrashGlyph size={13} />
        </button>
      )}
    </div>
  );
}
