import { useCallback, useEffect, useRef } from "react";
import { useI18n } from "@/i18n";
import { abbreviateHomePath } from "@/lib/display-path";
import { AnimatedDropdown } from "./animated-dropdown";
import { PathLabel } from "./path-label";
import { WorktreeRemoveConfirm } from "./worktree-remove-confirm";
import type { WorktreeState } from "./project-workspace";

// Split from SessionSidebar.tsx in Phase 2. Pure view for the worktree
// switcher: dropdown visibility, the new-worktree entry, busy/error and the
// dirty-remove confirmation are owned by the persistent project-workspace hook
// (review R1 finding 1 — an in-flight operation must survive project switches),
// so every state here arrives as props and every action delegates back.

export function WorktreeSwitcher({
  worktreeState,
  selectedCwd,
  homeDir,
  dropdownOpen,
  onToggleDropdown,
  onOutsideClickClose,
  newOpen,
  onOpenNewEntry,
  onCloseNewEntry,
  newBranch,
  onNewBranchChange,
  busy,
  error,
  confirmRemovePath,
  onCancelRemove,
  onCreateWorktree,
  onRemoveWorktree,
  onSelectWorktree,
  deferFocus,
}: {
  worktreeState: WorktreeState;
  selectedCwd: string | null;
  homeDir: string;
  dropdownOpen: boolean;
  onToggleDropdown: () => void;
  onOutsideClickClose: () => void;
  newOpen: boolean;
  onOpenNewEntry: () => void;
  onCloseNewEntry: () => void;
  newBranch: string;
  onNewBranchChange: (branch: string) => void;
  busy: boolean;
  error: string | null;
  confirmRemovePath: string | null;
  onCancelRemove: () => void;
  onCreateWorktree: () => void;
  onRemoveWorktree: (path: string, force: boolean) => void;
  onSelectWorktree: (path: string) => void;
  deferFocus: (focus: () => void) => void;
}) {
  const { t } = useI18n();
  const wtDropdownRef = useRef<HTMLDivElement>(null);
  const wtNewInputRef = useRef<HTMLInputElement>(null);

  // Close dropdown on outside click — the reset action belongs to the
  // persistent owner; the listener itself is per-dropdown view wiring.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wtDropdownRef.current && !wtDropdownRef.current.contains(e.target as Node)) {
        onOutsideClickClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onOutsideClickClose]);

  const currentWt =
    worktreeState.worktrees.find((w) => w.path === selectedCwd) ?? worktreeState.worktrees.find((w) => w.isMain);

  const openNewEntry = useCallback(() => {
    onOpenNewEntry();
    deferFocus(() => wtNewInputRef.current?.focus());
  }, [onOpenNewEntry, deferFocus]);

  return (
    <div ref={wtDropdownRef} style={{ position: "relative", marginTop: 8 }}>
      <button
        onClick={onToggleDropdown}
        title={
          currentWt
            ? t("switchWorktreePath", "Switch worktree: {path}").replace("{path}", currentWt.path)
            : t("switchWorktree", "Switch worktree")
        }
        style={{
          width: "100%",
          height: 29,
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 12px",
          background: "var(--bg-hover)",
          border: "1px solid var(--fx-line-default)",
          borderRadius: "var(--radius-card)",
          cursor: "pointer",
          fontSize: "var(--text-meta)",
          lineHeight: 1.35,
          color: "var(--fx-text-secondary)",
          textAlign: "left",
        }}
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            flexShrink: 0,
            color: currentWt && !currentWt.isMain ? "var(--fx-accent-blue)" : "var(--fx-text-tertiary)",
          }}
        >
          <line x1="6" y1="3" x2="6" y2="15" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M18 9a9 9 0 0 1-9 9" />
        </svg>
        <PathLabel
          text={currentWt ? (currentWt.branch ?? abbreviateHomePath(currentWt.path, homeDir)) : "…"}
          style={{ flex: 1, fontFamily: "var(--font-mono)", color: "var(--fx-text-primary)" }}
        />
        {currentWt?.isMain && (
          <span style={{ flexShrink: 0, color: "var(--fx-text-tertiary)", fontSize: "var(--text-micro)" }}>
            {t("mainBranch", "main")}
          </span>
        )}
        {worktreeState.worktrees.length > 1 && (
          <span style={{ flexShrink: 0, color: "var(--fx-text-tertiary)", fontSize: "var(--text-micro)" }}>
            {worktreeState.worktrees.length}
          </span>
        )}
        <svg
          width="9"
          height="9"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0 }}
        >
          <polyline points="2 3.5 5 6.5 8 3.5" />
        </svg>
      </button>

      <AnimatedDropdown
        open={dropdownOpen}
        style={{
          position: "absolute",
          top: "calc(100% + 4px)",
          left: 0,
          right: 0,
          zIndex: 100,
          background: "var(--fx-surface-main)",
          border: "1px solid var(--fx-line-default)",
          borderRadius: "var(--radius-card)",
          boxShadow: "0 6px 20px rgba(0,0,0,0.10)",
          overflow: "hidden",
        }}
      >
        <div style={{ maxHeight: "min(40vh, 300px)", overflowY: "auto" }}>
          {worktreeState.worktrees.map((wt) => {
            const isCurrent =
              wt.path === selectedCwd || (wt.isMain && !worktreeState.worktrees.some((w) => w.path === selectedCwd));
            if (confirmRemovePath === wt.path) {
              return (
                <WorktreeRemoveConfirm
                  key={wt.path}
                  busy={busy}
                  onForce={() => onRemoveWorktree(wt.path, true)}
                  onCancel={onCancelRemove}
                />
              );
            }
            return (
              <div
                key={wt.path}
                className="wt-row"
                style={{ display: "flex", alignItems: "center", borderBottom: "1px solid var(--fx-line-default)" }}
              >
                <button
                  onClick={() => onSelectWorktree(wt.path)}
                  title={wt.path}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 12px",
                    background: "var(--fx-surface-main)",
                    border: "none",
                    color: isCurrent ? "var(--fx-text-primary)" : "var(--fx-text-secondary)",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: "var(--text-meta)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {isCurrent ? (
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 10 10"
                      fill="none"
                      stroke="var(--fx-accent-blue)"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ flexShrink: 0 }}
                    >
                      <polyline points="1.5 5 4 7.5 8.5 2.5" />
                    </svg>
                  ) : (
                    <span style={{ width: 10, flexShrink: 0 }} />
                  )}
                  <PathLabel text={wt.branch ?? abbreviateHomePath(wt.path, homeDir)} style={{ flex: 1 }} />
                  {wt.isMain && (
                    <span style={{ flexShrink: 0, color: "var(--fx-text-tertiary)", fontSize: "var(--text-micro)" }}>
                      {t("mainBranch", "main")}
                    </span>
                  )}
                </button>
                {!wt.isMain && (
                  <button
                    onClick={() => onRemoveWorktree(wt.path, false)}
                    disabled={busy}
                    title={t("removeWorktreeHint", "Remove worktree checkout {path}; the branch is kept").replace(
                      "{path}",
                      wt.path,
                    )}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 34,
                      height: 28,
                      padding: 0,
                      marginRight: 4,
                      background: "none",
                      border: "none",
                      color: "var(--fx-text-tertiary)",
                      cursor: "pointer",
                      borderRadius: "var(--radius-control)",
                      flexShrink: 0,
                      transition:
                        "color var(--duration-quick, 150ms) var(--ease-smooth-out, ease), background var(--duration-quick, 150ms) var(--ease-smooth-out, ease)",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = "var(--fx-status-danger)";
                      e.currentTarget.style.background = "rgba(239,68,68,0.08)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = "var(--fx-text-tertiary)";
                      e.currentTarget.style.background = "none";
                    }}
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                      <path d="M10 11v6M14 11v6" />
                      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                    </svg>
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {!newOpen ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              openNewEntry();
            }}
            title={t("createWorktreeHint", "Create a worktree checkout for a branch")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              padding: "8px 12px",
              background: "none",
              border: "none",
              color: "var(--fx-text-secondary)",
              cursor: "pointer",
              textAlign: "left",
              fontSize: "var(--text-meta)",
            }}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeLinecap="round"
              style={{ flexShrink: 0 }}
            >
              <line x1="5" y1="1" x2="5" y2="9" />
              <line x1="1" y1="5" x2="9" y2="5" />
            </svg>
            <span>{t("newWorktree", "New worktree…")}</span>
          </button>
        ) : (
          <div style={{ padding: "8px 8px" }}>
            <input
              ref={wtNewInputRef}
              value={newBranch}
              onChange={(e) => onNewBranchChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onCreateWorktree();
                }
                if (e.key === "Escape") {
                  onCloseNewEntry();
                }
              }}
              placeholder={t("branchName", "branch name")}
              style={{
                width: "100%",
                fontSize: "var(--text-meta)",
                fontFamily: "var(--font-mono)",
                padding: "4px 8px",
                border: "1px solid var(--fx-accent-blue)",
                borderRadius: "var(--radius-control)",
                outline: "none",
                background: "var(--fx-surface-main)",
                color: "var(--fx-text-primary)",
                boxSizing: "border-box",
              }}
            />
            <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
              <button
                onClick={onCreateWorktree}
                disabled={busy || !newBranch.trim()}
                style={{
                  flex: 1,
                  padding: "4px 0",
                  background: "var(--fx-accent-blue-fill)",
                  border: "none",
                  borderRadius: "var(--radius-control)",
                  color: "var(--fx-text-on-accent)",
                  fontSize: "var(--text-meta)",
                  fontWeight: 600,
                  cursor: busy || !newBranch.trim() ? "not-allowed" : "pointer",
                  opacity: busy || !newBranch.trim() ? 0.65 : 1,
                }}
              >
                {busy ? t("creating", "Creating…") : t("create", "Create")}
              </button>
              <button
                onClick={onCloseNewEntry}
                style={{
                  flex: 1,
                  padding: "4px 0",
                  background: "var(--bg-hover)",
                  border: "1px solid var(--fx-line-default)",
                  borderRadius: "var(--radius-control)",
                  color: "var(--fx-text-secondary)",
                  fontSize: "var(--text-meta)",
                  cursor: "pointer",
                }}
              >
                {t("cancel", "Cancel")}
              </button>
            </div>
          </div>
        )}
        {error && (
          <div
            style={{
              padding: "4px 12px 8px",
              color: "var(--fx-status-danger)",
              fontSize: "var(--text-meta)",
              lineHeight: 1.35,
              overflowWrap: "anywhere",
            }}
          >
            {error}
          </div>
        )}
      </AnimatedDropdown>
    </div>
  );
}
