import { useEffect, useId, useRef } from "react";
import { useI18n } from "@/i18n";
import { FolderIcon } from "../FileIcons";
import { ChevronDownIcon } from "./icons";
import { CLEAR, HOVER, paint, QUICK } from "./menu-chrome";
import type { ComposerWorkspace } from "./types";
import { ELLIPSIS, GLYPH, GitBranchGlyph } from "./workspace-chrome";
import { WorkspaceMenu } from "./workspace-menu";

export function WorkspaceTrigger({ workspace, isMobile }: { workspace: ComposerWorkspace; isMobile: boolean }) {
  const { t } = useI18n();
  const { project, current, currentPath, menuOpen, closeMenu } = workspace;
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!menuOpen) return;
    const onMouseDown = (event: globalThis.MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) closeMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      if (event.key !== "Escape") return;
      event.stopPropagation();
      closeMenu();
      buttonRef.current?.focus();
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [menuOpen, closeMenu]);

  const branch = current?.branch ?? null;
  const canPick = workspace.checkouts.length > 0;
  const title = canPick
    ? currentPath
      ? t("switchWorktreePath", "Switch worktree: {path}").replace("{path}", currentPath)
      : t("switchWorktree", "Switch worktree")
    : t("workspaceSettings", "Workspace settings");
  const label = branch
    ? t("workspaceTriggerBranchLabel", "Workspace: {project}, branch {branch}")
        .replace("{project}", project.name)
        .replace("{branch}", branch)
    : t("workspaceTriggerLabel", "Workspace: {project}").replace("{project}", project.name);

  return (
    <div ref={rootRef} style={{ position: "relative", display: "flex", minWidth: 0, maxWidth: "100%" }}>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={menuOpen}
        aria-controls={menuId}
        aria-label={label}
        title={title}
        onClick={workspace.toggleMenu}
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
          background: menuOpen ? HOVER : CLEAR,
          border: "none",
          borderRadius: "var(--radius-control)",
          color: "var(--fx-text-primary)",
          cursor: "pointer",
          transition: QUICK,
        }}
        onMouseEnter={(event) => paint(event, HOVER)}
        onMouseLeave={(event) => paint(event, menuOpen ? HOVER : CLEAR)}
      >
        <span style={{ ...GLYPH, color: "var(--fx-text-secondary)" }}>
          <FolderIcon size={14} color="currentColor" />
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
      {menuOpen && <WorkspaceMenu id={menuId} workspace={workspace} />}
    </div>
  );
}
