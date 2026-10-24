import { useState } from "react";
import { useI18n } from "@/i18n";
import { FolderIcon } from "../FileIcons";
import { WorktreeRemoveConfirm } from "../session-sidebar/worktree-remove-confirm";
import { CheckmarkIcon, Icon, PlusIcon } from "./icons";
import { CLEAR, HOVER, paint, QUICK } from "./menu-chrome";
import type { ComposerCheckout, ComposerWorkspace } from "./types";
import { ELLIPSIS, GLYPH, GitBranchGlyph, ROW, SECTION, SELECTED, SEPARATOR } from "./workspace-chrome";

export function WorkspaceMenu({ id, workspace }: { id: string; workspace: ComposerWorkspace }) {
  const { t } = useI18n();
  const { project } = workspace;
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const runAction = (action: () => Promise<void>, failure: (error: unknown) => string) => {
    setActionError(null);
    void action().then(workspace.closeMenu, (error: unknown) => setActionError(failure(error)));
  };

  const renderCheckout = (entry: ComposerCheckout) => {
    const selected = workspace.current?.path === entry.path;
    if (workspace.confirmRemovePath === entry.path) {
      return (
        <WorktreeRemoveConfirm
          key={entry.path}
          busy={workspace.busy}
          onForce={() => workspace.removeCheckout(entry.path, true)}
          onCancel={workspace.cancelRemove}
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
          aria-current={selected ? "true" : undefined}
          title={entry.path}
          onClick={() => workspace.selectCheckout(entry.path)}
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
          {selected && (
            <span style={{ ...GLYPH, color: "var(--fx-accent-blue-text)" }}>
              <CheckmarkIcon />
            </span>
          )}
        </button>
        {!entry.isMain && (
          <button
            type="button"
            onClick={() => workspace.removeCheckout(entry.path, false)}
            disabled={workspace.busy}
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
              cursor: workspace.busy ? "not-allowed" : "pointer",
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

  const message = actionError ?? workspace.error;

  return (
    <div
      id={id}
      role="group"
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
      <div style={{ ...ROW, height: 44, background: SELECTED, cursor: "default" }}>
        <span style={{ ...GLYPH, color: "var(--fx-text-primary)" }}>
          <FolderIcon size={15} open color="currentColor" />
        </span>
        <span style={{ display: "flex", flexDirection: "column", gap: 1, flex: 1, minWidth: 0 }}>
          <span className="type-body-medium" style={{ ...ELLIPSIS, color: "var(--fx-text-primary)" }}>
            {project.name}
          </span>
          <span className="type-mono-meta" style={{ ...ELLIPSIS, color: "var(--fx-text-tertiary)" }}>
            {project.displayPath}
          </span>
        </span>
        <span style={{ ...GLYPH, color: "var(--fx-accent-blue-text)" }}>
          <CheckmarkIcon />
        </span>
      </div>
      <button
        type="button"
        onClick={workspace.switchProject}
        style={{ ...ROW, background: CLEAR, color: "var(--fx-text-secondary)" }}
        onMouseEnter={(event) => paint(event, HOVER)}
        onMouseLeave={(event) => paint(event, CLEAR)}
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

      {workspace.checkouts.length > 0 && (
        <>
          <div style={SEPARATOR} />
          <div className="type-meta-caps" style={SECTION}>
            {t("branchSection", "Branches & worktrees")}
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 2,
              maxHeight: "min(28vh, 200px)",
              overflowY: "auto",
              overscrollBehavior: "contain",
            }}
          >
            {workspace.checkouts.map(renderCheckout)}
          </div>
          {workspace.newEntryOpen ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "6px 8px 8px" }}>
              <input
                autoFocus
                value={workspace.newBranch}
                onChange={(event) => workspace.setNewBranch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    workspace.createCheckout();
                  }
                  if (event.key === "Escape") {
                    event.stopPropagation();
                    workspace.closeNewEntry();
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
                  onClick={workspace.createCheckout}
                  disabled={workspace.busy || !workspace.newBranch.trim()}
                  className="type-label-medium"
                  style={{
                    flex: 1,
                    height: 28,
                    background: "var(--fx-accent-blue-fill)",
                    border: "none",
                    borderRadius: "var(--radius-control)",
                    color: "var(--fx-text-on-accent)",
                    cursor: workspace.busy || !workspace.newBranch.trim() ? "not-allowed" : "pointer",
                    opacity: workspace.busy || !workspace.newBranch.trim() ? 0.65 : 1,
                  }}
                >
                  {workspace.busy ? t("creating", "Creating…") : t("create", "Create")}
                </button>
                <button
                  type="button"
                  onClick={workspace.closeNewEntry}
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
              onClick={workspace.openNewEntry}
              title={t("createWorktreeHint", "Create a worktree checkout for a branch")}
              style={{ ...ROW, background: CLEAR, color: "var(--fx-text-secondary)" }}
              onMouseEnter={(event) => paint(event, HOVER)}
              onMouseLeave={(event) => paint(event, CLEAR)}
            >
              <span style={{ ...GLYPH, color: "var(--fx-text-secondary)" }}>
                <PlusIcon size={15} />
              </span>
              <span className="type-body-default" style={{ ...ELLIPSIS, flex: 1 }}>
                {t("newWorktree", "New worktree…")}
              </span>
            </button>
          )}
        </>
      )}

      {message && (
        <div
          role="alert"
          className="type-meta-default"
          style={{ padding: "4px 8px", color: "var(--fx-status-danger-text)", overflowWrap: "anywhere" }}
        >
          {message}
        </div>
      )}

      <div style={SEPARATOR} />
      <button
        type="button"
        onClick={() =>
          runAction(workspace.openInFinder, (error) => (error instanceof Error ? error.message : String(error)))
        }
        style={{ ...ROW, background: CLEAR, color: "var(--fx-text-secondary)" }}
        onMouseEnter={(event) => paint(event, HOVER)}
        onMouseLeave={(event) => paint(event, CLEAR)}
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
        onClick={() => runAction(workspace.copyPath, () => t("copyFailed", "Copy failed"))}
        style={{ ...ROW, background: CLEAR, color: "var(--fx-text-secondary)" }}
        onMouseEnter={(event) => paint(event, HOVER)}
        onMouseLeave={(event) => paint(event, CLEAR)}
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
