import { useCallback, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import { WorktreeRemoveConfirm } from "../session-sidebar/worktree-remove-confirm";
import type { WorktreeEntry } from "../session-sidebar/project-workspace";
import { Icon } from "./icons";
import type { ComposerWorkspace } from "./types";
import {
  CLEAR,
  CheckMark,
  ELLIPSIS,
  GLYPH,
  GitBranchGlyph,
  HOVER,
  HOVER_ROW,
  QUICK,
  ROW,
  SECTION,
  SELECTED,
  SEPARATOR,
} from "./workspace-chrome";

const FOLDER_OPEN_PATH =
  "m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2";

/** The workspace menu, anchored above the composer footer's workspace trigger. */
export function WorkspaceMenu({ workspace }: { workspace: ComposerWorkspace }) {
  const { t } = useI18n();
  const { workspace: state, project, onSwitchProject, onOpenInFinder, onCopyPath, deferFocus } = workspace;
  const branchInputRef = useRef<HTMLInputElement>(null);
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);
  const [focusedPath, setFocusedPath] = useState<string | null>(null);

  const { worktreeState, selectedCwd } = state;
  const worktrees = worktreeState?.worktrees ?? [];
  const currentPath = selectedCwd ?? worktreeState?.projectRoot ?? null;
  const canPickCheckout = state.showWorktreeSwitcher && worktrees.length > 0;

  const close = useCallback(() => state.resetWorktreeDropdownForOutsideClick(), [state]);
  const openNewEntry = useCallback(() => {
    state.openNewWorktreeEntry();
    deferFocus(() => branchInputRef.current?.focus());
  }, [state, deferFocus]);

  const renderWorktree = (entry: WorktreeEntry) => {
    const selected =
      entry.path === currentPath || (entry.isMain && !worktrees.some((item) => item.path === currentPath));
    if (state.wtConfirmRemove === entry.path) {
      return (
        <WorktreeRemoveConfirm
          key={entry.path}
          busy={state.wtBusy}
          onForce={() => state.handleRemoveWorktree(entry.path, true)}
          onCancel={state.cancelWorktreeRemove}
        />
      );
    }
    const revealed = hoveredPath === entry.path || focusedPath === entry.path;
    const showsRemove = revealed && !entry.isMain;
    return (
      <div
        key={entry.path}
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          borderRadius: "var(--radius-control)",
          background: selected ? SELECTED : revealed ? HOVER : CLEAR,
        }}
        onMouseEnter={() => setHoveredPath(entry.path)}
        onMouseLeave={() => setHoveredPath((path) => (path === entry.path ? null : path))}
      >
        <button
          type="button"
          role="menuitemradio"
          aria-checked={selected}
          title={entry.path}
          onClick={() => state.handleSelectWorktree(entry.path)}
          style={{ ...ROW, flex: 1, minWidth: 0, paddingRight: showsRemove ? 32 : 8, background: "transparent" }}
        >
          <span style={{ ...GLYPH, color: selected ? "var(--fx-text-primary)" : "var(--fx-text-secondary)" }}>
            <GitBranchGlyph size={15} />
          </span>
          <span
            className="type-mono-label"
            style={{ ...ELLIPSIS, flex: 1, color: selected ? "var(--fx-text-primary)" : "var(--fx-text-secondary)" }}
          >
            {entry.branch ?? entry.path}
          </span>
          {!showsRemove && (
            <span className="type-meta-default" style={{ flexShrink: 0, color: "var(--fx-text-tertiary)" }}>
              {entry.isMain ? t("mainBranch", "Main branch") : t("worktreeEntryKind", "worktree")}
            </span>
          )}
          {selected && <CheckMark />}
        </button>
        {!entry.isMain && (
          <button
            type="button"
            onClick={() => state.handleRemoveWorktree(entry.path, false)}
            disabled={state.wtBusy}
            onFocus={() => setFocusedPath(entry.path)}
            onBlur={() => setFocusedPath((path) => (path === entry.path ? null : path))}
            title={t("removeWorktreeHint", "Remove worktree checkout {path}; the branch is kept").replace(
              "{path}",
              entry.path,
            )}
            aria-label={t("removeWorktreeHint", "Remove worktree checkout {path}; the branch is kept").replace(
              "{path}",
              entry.path,
            )}
            style={{
              position: "absolute",
              top: 5,
              right: 4,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 22,
              height: 22,
              padding: 0,
              border: "none",
              borderRadius: "var(--radius-chip)",
              background: "transparent",
              color: "var(--fx-text-tertiary)",
              cursor: state.wtBusy ? "not-allowed" : "pointer",
              opacity: revealed ? 1 : 0,
              pointerEvents: revealed ? "auto" : "none",
              transition: `opacity ${QUICK}, color ${QUICK}`,
            }}
            onMouseEnter={(event) => {
              event.currentTarget.style.color = "var(--fx-status-danger)";
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.color = "var(--fx-text-tertiary)";
            }}
          >
            <Icon size={12} strokeWidth={2}>
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </Icon>
          </button>
        )}
      </div>
    );
  };

  return (
    <div
      role="menu"
      aria-label={t("workspaceMenu", "Workspace")}
      className="composer-pop-in"
      style={{
        position: "absolute",
        left: 0,
        bottom: "calc(100% + 8px)",
        zIndex: 130,
        transformOrigin: "bottom left",
        width: 300,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: 2,
        padding: 6,
        background: "var(--fx-surface-raised)",
        border: "1px solid var(--fx-line-default)",
        borderRadius: "var(--radius-menu)",
        boxShadow: "var(--shadow-picker)",
        overflow: "hidden",
      }}
    >
      <div className="type-meta-caps" style={SECTION}>
        {t("projectSection", "Project")}
      </div>
      <button
        type="button"
        role="menuitemradio"
        aria-checked
        onClick={close}
        style={{ ...ROW, height: 44, background: SELECTED }}
      >
        <span style={{ ...GLYPH, color: "var(--fx-text-primary)" }}>
          <Icon size={15} strokeWidth={1.75}>
            <path d={FOLDER_OPEN_PATH} />
          </Icon>
        </span>
        <span style={{ display: "flex", flexDirection: "column", gap: 1, flex: 1, minWidth: 0 }}>
          <span className="type-body-medium" style={{ ...ELLIPSIS, color: "var(--fx-text-primary)" }}>
            {project.name}
          </span>
          <span className="type-mono-meta" style={{ ...ELLIPSIS, color: "var(--fx-text-tertiary)" }}>
            {project.displayPath}
          </span>
        </span>
        <CheckMark />
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={onSwitchProject}
        style={{ ...ROW, background: CLEAR, color: "var(--fx-text-secondary)" }}
        {...HOVER_ROW}
      >
        <span style={{ ...GLYPH, color: "var(--fx-text-secondary)" }}>
          <Icon size={15} strokeWidth={1.75}>
            <path d="M20 17a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3.9a2 2 0 0 1-1.69-.9l-.81-1.2a2 2 0 0 0-1.67-.9H8a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2Z" />
            <path d="M2 8v11a2 2 0 0 0 2 2h14" />
          </Icon>
        </span>
        <span className="type-body-default" style={{ ...ELLIPSIS, flex: 1 }}>
          {t("switchProject", "Switch project…")}
        </span>
      </button>

      {canPickCheckout && (
        <>
          <div style={SEPARATOR} />
          <div className="type-meta-caps" style={SECTION}>
            {t("branchSection", "Branches & worktrees")}
          </div>
          {worktrees.map(renderWorktree)}
          {state.wtNewOpen ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "6px 8px 8px" }}>
              <input
                ref={branchInputRef}
                value={state.wtNewBranch}
                onChange={(event) => state.setNewWorktreeBranch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    state.handleCreateWorktree();
                  }
                  if (event.key === "Escape") {
                    event.stopPropagation();
                    state.closeNewWorktreeEntry();
                  }
                }}
                placeholder={t("branchName", "branch name")}
                aria-label={t("branchName", "branch name")}
                className="type-mono-label"
                style={{
                  width: "100%",
                  height: 30,
                  boxSizing: "border-box",
                  padding: "0 8px",
                  border: "1px solid var(--fx-accent-blue)",
                  borderRadius: "var(--radius-control)",
                  outline: "none",
                  background: "var(--fx-surface-main)",
                  color: "var(--fx-text-primary)",
                }}
              />
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  type="button"
                  onClick={state.handleCreateWorktree}
                  disabled={state.wtBusy || !state.wtNewBranch.trim()}
                  className="type-label-medium"
                  style={{
                    flex: 1,
                    height: 28,
                    background: "var(--fx-accent-blue-fill)",
                    border: "none",
                    borderRadius: "var(--radius-control)",
                    color: "var(--fx-text-on-accent)",
                    cursor: state.wtBusy || !state.wtNewBranch.trim() ? "not-allowed" : "pointer",
                    opacity: state.wtBusy || !state.wtNewBranch.trim() ? 0.65 : 1,
                  }}
                >
                  {state.wtBusy ? t("creating", "Creating…") : t("create", "Create")}
                </button>
                <button
                  type="button"
                  onClick={state.closeNewWorktreeEntry}
                  className="type-label-default"
                  style={{
                    flex: 1,
                    height: 28,
                    background: HOVER,
                    border: "1px solid var(--fx-line-default)",
                    borderRadius: "var(--radius-control)",
                    color: "var(--fx-text-secondary)",
                    cursor: "pointer",
                  }}
                >
                  {t("cancel", "Cancel")}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              role="menuitem"
              onClick={openNewEntry}
              title={t("createWorktreeHint", "Create a worktree checkout for a branch")}
              style={{ ...ROW, background: CLEAR, color: "var(--fx-text-secondary)" }}
              {...HOVER_ROW}
            >
              <span style={{ ...GLYPH, color: "var(--fx-text-secondary)" }}>
                <Icon size={15} strokeWidth={1.75}>
                  <path d="M12 5v14M5 12h14" />
                </Icon>
              </span>
              <span className="type-body-default" style={{ ...ELLIPSIS, flex: 1 }}>
                {t("newWorktree", "New worktree…")}
              </span>
            </button>
          )}
        </>
      )}

      {state.wtError && (
        <div
          role="alert"
          className="type-meta-default"
          style={{ padding: "4px 8px", color: "var(--fx-status-danger-text)", overflowWrap: "anywhere" }}
        >
          {state.wtError}
        </div>
      )}

      <div style={SEPARATOR} />
      <button
        type="button"
        role="menuitem"
        onClick={onOpenInFinder}
        style={{ ...ROW, background: CLEAR, color: "var(--fx-text-secondary)" }}
        {...HOVER_ROW}
      >
        <span style={{ ...GLYPH, color: "var(--fx-text-secondary)" }}>
          <Icon size={15} strokeWidth={1.75}>
            <path d="M15 3h6v6" />
            <path d="M10 14 21 3" />
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          </Icon>
        </span>
        <span className="type-body-default" style={{ ...ELLIPSIS, flex: 1 }}>
          {t("openInFinder", "Open in Finder")}
        </span>
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={onCopyPath}
        style={{ ...ROW, background: CLEAR, color: "var(--fx-text-secondary)" }}
        {...HOVER_ROW}
      >
        <span style={{ ...GLYPH, color: "var(--fx-text-secondary)" }}>
          <Icon size={15} strokeWidth={1.75}>
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </Icon>
        </span>
        <span className="type-body-default" style={{ ...ELLIPSIS, flex: 1 }}>
          {t("copyProjectPath", "Copy project path")}
        </span>
      </button>
    </div>
  );
}
