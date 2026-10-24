import { useCallback, useEffect, useRef } from "react";
import { useI18n } from "@/i18n";
import { ChevronDownIcon, Icon } from "./icons";
import type { ComposerWorkspace } from "./types";
import { CLEAR, ELLIPSIS, FOLDER_PATH, GLYPH, GitBranchGlyph, HOVER, QUICK } from "./workspace-chrome";
import { WorkspaceMenu } from "./workspace-menu";

/** Footer workspace trigger — the project and branch this composer writes to,
 *  with the workspace menu opening upward above it. */
export function WorkspaceTrigger({ workspace, isMobile }: { workspace: ComposerWorkspace; isMobile: boolean }) {
  const { t } = useI18n();
  const { workspace: state, project } = workspace;
  const rootRef = useRef<HTMLDivElement>(null);
  const { worktreeState, selectedCwd, wtDropdownOpen } = state;

  const close = useCallback(() => state.resetWorktreeDropdownForOutsideClick(), [state]);

  useEffect(() => {
    if (!wtDropdownOpen) return;
    const onMouseDown = (event: globalThis.MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close();
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [wtDropdownOpen, close]);

  const worktrees = worktreeState?.worktrees ?? [];
  const currentPath = selectedCwd ?? worktreeState?.projectRoot ?? null;
  const canPickCheckout = state.showWorktreeSwitcher && worktrees.length > 0;
  const checkout =
    worktrees.find((entry) => entry.path === selectedCwd) ?? (canPickCheckout ? worktrees.find((e) => e.isMain) : null);
  const branch = checkout?.branch ?? null;
  const title = canPickCheckout
    ? currentPath
      ? t("switchWorktreePath", "Switch worktree: {path}").replace("{path}", currentPath)
      : t("switchWorktree", "Switch worktree")
    : t("workspaceSettings", "Workspace settings");

  return (
    <div ref={rootRef} style={{ position: "relative", display: "flex", minWidth: 0, maxWidth: "100%" }}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={wtDropdownOpen}
        aria-label={t("workspaceSettings", "Workspace settings")}
        title={title}
        onClick={state.toggleWorktreeDropdown}
        className="type-body-medium"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          height: 30,
          maxWidth: "100%",
          minWidth: 0,
          boxSizing: "border-box",
          padding: "0 8px 0 6px",
          background: wtDropdownOpen ? HOVER : CLEAR,
          border: "none",
          borderRadius: "var(--radius-control)",
          color: "var(--fx-text-primary)",
          cursor: "pointer",
          transition: QUICK,
        }}
        onMouseEnter={(event) => {
          event.currentTarget.style.background = HOVER;
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.background = wtDropdownOpen ? HOVER : CLEAR;
        }}
      >
        <span style={{ ...GLYPH, color: "var(--fx-text-secondary)" }}>
          <Icon size={14} strokeWidth={1.75}>
            <path d={FOLDER_PATH} />
          </Icon>
        </span>
        <span style={{ ...ELLIPSIS, flexShrink: 1 }}>{project.name}</span>
        {branch && !isMobile && (
          <>
            <span
              aria-hidden="true"
              style={{ width: 3, height: 3, flexShrink: 0, borderRadius: 2, background: "var(--fx-text-faint)" }}
            />
            <span style={{ ...GLYPH, color: "var(--fx-text-tertiary)" }}>
              <GitBranchGlyph size={13} />
            </span>
            <span className="type-mono-label" style={{ ...ELLIPSIS, flexShrink: 1, color: "var(--fx-text-secondary)" }}>
              {branch}
            </span>
          </>
        )}
        <span style={{ ...GLYPH, color: "var(--fx-text-tertiary)" }}>
          <ChevronDownIcon size={12} />
        </span>
      </button>
      {wtDropdownOpen && <WorkspaceMenu workspace={workspace} />}
    </div>
  );
}
