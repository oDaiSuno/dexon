import { useState } from "react";
import { useI18n } from "@/i18n";
import { FolderIcon } from "../FileIcons";
import { WorktreeSwitcher } from "../session-sidebar/worktree-switcher";
import { CheckmarkIcon, Icon } from "./icons";
import { CLEAR, HOVER, paint } from "./menu-chrome";
import type { ComposerWorkspace } from "./types";
import { ELLIPSIS, GLYPH, ROW, SECTION, SELECTED, SEPARATOR } from "./workspace-chrome";

export function WorkspaceMenu({ id, workspace }: { id: string; workspace: ComposerWorkspace }) {
  const { t } = useI18n();
  const { project } = workspace;
  const [actionError, setActionError] = useState<string | null>(null);
  const platform = window.piBridge?.platform;
  const revealLabel =
    platform === "win32"
      ? t("openInExplorer", "Open in File Explorer")
      : platform === "linux"
        ? t("openInFileManager", "Open in File Manager")
        : t("openInFinder", "Open in Finder");

  const runAction = (action: () => Promise<void>, failure: (error: unknown) => string) => {
    setActionError(null);
    void action().then(workspace.closeMenu, (error: unknown) => setActionError(failure(error)));
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

      <WorktreeSwitcher workspace={workspace} />

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
          {revealLabel}
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
