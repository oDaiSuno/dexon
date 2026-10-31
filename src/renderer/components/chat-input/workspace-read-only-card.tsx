import { useEffect, useRef, useState, type RefObject } from "react";
import { useI18n } from "@/i18n";
import { CLEAR, HOVER, paint } from "./menu-chrome";
import type { ComposerWorkspaceReadOnly } from "./types";
import { CARD_ABOVE_TRIGGER, FOOTER_BUTTON, READ_ONLY_WIDTH } from "./workspace-card-position";
import { SURFACE_RAISED } from "./workspace-chrome";
import { CopyGlyph, ExternalLinkGlyph, FolderGitGlyph, LockKeyholeGlyph } from "./workspace-glyphs";

const ICON_BUTTON = {
  ...FOOTER_BUTTON,
  width: 28,
  height: 28,
  padding: 0,
  justifyContent: "center",
  color: "var(--fx-text-secondary)",
} as const;

export function WorkspaceReadOnlyCard({
  id,
  workspace,
  onRequestClose,
  onFocusTrigger,
}: {
  id: string;
  workspace: ComposerWorkspaceReadOnly;
  anchorRef: RefObject<HTMLButtonElement | null>;
  onRequestClose: () => void;
  onFocusTrigger: () => void;
}) {
  const { t } = useI18n();
  const [actionError, setActionError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    rootRef.current?.focus();
  }, []);
  const platform = window.piBridge?.platform;
  const revealLabel =
    platform === "win32"
      ? t("openInExplorer", "Open in File Explorer")
      : platform === "linux"
        ? t("openInFileManager", "Open in File Manager")
        : t("openInFinder", "Open in Finder");

  const runAction = (action: () => Promise<void>, failure: (error: unknown) => string) => {
    setActionError(null);
    void action().then(onRequestClose, (error: unknown) => setActionError(failure(error)));
  };

  return (
    <div
      id={id}
      ref={rootRef}
      role="group"
      aria-label={t("workspaceMenu", "Workspace")}
      aria-readonly="true"
      tabIndex={-1}
      className="composer-pop-in workspace-card"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onRequestClose();
        onFocusTrigger();
      }}
      style={{
        position: "absolute",
        left: 0,
        bottom: CARD_ABOVE_TRIGGER,
        zIndex: 130,
        width: READ_ONLY_WIDTH,
        maxWidth: "calc(100vw - 16px)",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        padding: 12,
        background: SURFACE_RAISED,
        border: "1px solid var(--fx-line-default)",
        borderRadius: "var(--radius-menu)",
        boxShadow: "var(--shadow-picker)",
        overflow: "hidden",
        outline: "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 36,
            height: 36,
            flexShrink: 0,
            boxSizing: "border-box",
            border: "1px solid var(--fx-line-default)",
            borderRadius: "var(--radius-segmented)",
            background: "var(--fx-surface-inset)",
            color: "var(--fx-text-primary)",
          }}
        >
          <FolderGitGlyph size={17} />
        </span>
        <span style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <span className="type-body-medium" style={{ color: "var(--fx-text-primary)" }}>
              {workspace.project.name}
            </span>
            {workspace.branch && (
              <>
                <span className="type-body-default" style={{ color: "var(--fx-text-tertiary)" }}>
                  /
                </span>
                <span className="type-mono-label-strong" style={{ color: "var(--fx-text-primary)" }}>
                  {workspace.branch}
                </span>
              </>
            )}
            {workspace.isWorktree && (
              <span
                className="type-meta-micro"
                style={{
                  padding: "1px 6px",
                  borderRadius: "var(--radius-xs)",
                  background: "var(--fx-line-subtle)",
                  color: "var(--fx-text-secondary)",
                }}
              >
                {t("worktreeEntryKind", "worktree")}
              </span>
            )}
          </span>
          <span
            className="type-mono-meta"
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              color: "var(--fx-text-tertiary)",
            }}
          >
            {workspace.path}
          </span>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
          <button
            type="button"
            aria-label={revealLabel}
            title={revealLabel}
            onClick={() =>
              runAction(workspace.openInFinder, (error) => (error instanceof Error ? error.message : String(error)))
            }
            style={ICON_BUTTON}
            onMouseEnter={(event) => paint(event, HOVER)}
            onMouseLeave={(event) => paint(event, CLEAR)}
          >
            <ExternalLinkGlyph size={14} />
          </button>
          <button
            type="button"
            aria-label={t("copyPath", "Copy path")}
            title={t("copyPath", "Copy path")}
            onClick={() => runAction(workspace.copyPath, () => t("copyFailed", "Copy failed"))}
            style={ICON_BUTTON}
            onMouseEnter={(event) => paint(event, HOVER)}
            onMouseLeave={(event) => paint(event, CLEAR)}
          >
            <CopyGlyph size={14} />
          </button>
        </span>
      </div>
      {actionError && (
        <div
          role="alert"
          className="type-meta-default"
          style={{ paddingTop: 6, color: "var(--fx-status-danger-text)", overflowWrap: "anywhere" }}
        >
          {actionError}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 0 0 48px" }}>
        <span style={{ display: "flex", flexShrink: 0, color: "var(--fx-text-tertiary)" }}>
          <LockKeyholeGlyph size={11} />
        </span>
        <span className="type-meta-default" style={{ color: "var(--fx-text-tertiary)" }}>
          {t("readOnlyNote", "This session was created here. To work elsewhere, start a new session.")}
        </span>
      </div>
    </div>
  );
}
