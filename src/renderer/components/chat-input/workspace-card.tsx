import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { useI18n } from "@/i18n";
import { KeyHint } from "./SendControls";
import { CLEAR, HOVER, paint } from "./menu-chrome";
import type { ComposerCardBranch, ComposerWorkspaceCard, ComposerWorkspaceSwitchable } from "./types";
import { WorkspaceBranchList } from "./workspace-branch-list";
import { CARD_WIDTH, SURFACE_RAISED } from "./workspace-chrome";
import { cardHeight, CARD_ABOVE_TRIGGER, FOOTER_BUTTON } from "./workspace-card-position";
import { WorkspaceProjectList } from "./workspace-project-list";
import { ActivityGlyph, CopyGlyph, ExternalLinkGlyph, FolderGitGlyph } from "./workspace-glyphs";

type Pane = "projects" | "branches";

function selectable(rows: ComposerCardBranch[]): string[] {
  return rows.filter((row) => !row.disabled).map((row) => row.key);
}

function branchKeys(card: ComposerWorkspaceCard): string[] {
  if (card.pane.state !== "ready") return [];
  return [
    ...selectable(card.pane.sections.current),
    ...selectable(card.pane.sections.folders),
    ...selectable(card.pane.sections.others),
  ];
}

function preferredKey(card: ComposerWorkspaceCard): string | null {
  if (card.pane.state !== "ready") return null;
  const rows = [...card.pane.sections.current, ...card.pane.sections.folders, ...card.pane.sections.others];
  return (
    rows.find((row) => row.kind === "current" && !row.disabled)?.key ?? rows.find((row) => !row.disabled)?.key ?? null
  );
}

export function WorkspaceCard({
  id,
  workspace,
  anchorRef,
  isMobile,
  onRequestClose,
  onFocusTrigger,
}: {
  id: string;
  workspace: ComposerWorkspaceSwitchable;
  anchorRef: RefObject<HTMLButtonElement | null>;
  isMobile: boolean;
  onRequestClose: () => void;
  onFocusTrigger: () => void;
}) {
  const { t } = useI18n();
  const card = workspace.card;
  const rootRef = useRef<HTMLDivElement>(null);
  const latestCardRef = useRef(card);
  latestCardRef.current = card;
  const focusedOnceRef = useRef(false);
  const [pane, setPane] = useState<Pane>("projects");
  const [activeKey, setActiveKey] = useState<string | null>(() => preferredKey(card));
  const [actionError, setActionError] = useState<string | null>(null);
  const [position, setPosition] = useState(() => cardHeight(anchorRef));

  const platform = window.piBridge?.platform;
  const revealLabel =
    platform === "win32"
      ? t("openInExplorer", "Open in File Explorer")
      : platform === "linux"
        ? t("openInFileManager", "Open in File Manager")
        : t("openInFinder", "Open in Finder");

  useLayoutEffect(() => {
    setPosition(cardHeight(anchorRef));
  }, [anchorRef]);

  const focusRow = useCallback((kind: "project" | "branch", key: string) => {
    const root = rootRef.current;
    if (!root || !key) return;
    const match = [...root.querySelectorAll<HTMLElement>(`[data-workspace-row="${kind}"]`)].find(
      (element) => element.dataset.workspaceKey === key,
    );
    match?.focus();
  }, []);

  const projectKeys = card.projects.filter((project) => !project.missing).map((project) => project.path);
  const browsedPath = card.projects.find((project) => project.browsed)?.path ?? "";

  useEffect(() => {
    if (focusedOnceRef.current) return;
    const first = latestCardRef.current.projects.find((project) => project.browsed);
    if (!first) return;
    focusedOnceRef.current = true;
    focusRow("project", first.path);
  }, [focusRow, card.projects]);

  const paneIdentity = card.pane.state === "ready" ? `ready:${card.pane.count}` : card.pane.state;
  const identity = `${card.browsedName}\u0000${paneIdentity}\u0000${card.filter}`;
  const identityRef = useRef(identity);
  if (identityRef.current !== identity) {
    identityRef.current = identity;
    setActiveKey(preferredKey(card));
  }

  const closeAndFocusTrigger = useCallback(() => {
    onRequestClose();
    onFocusTrigger();
  }, [onFocusTrigger, onRequestClose]);

  const browsedProjectPath = browsedPath;

  const moveBrowsed = (offset: -1 | 1) => {
    const index = projectKeys.indexOf(browsedProjectPath);
    const next = projectKeys[index + offset];
    if (!next) return;
    card.browseProject(next);
    focusRow("project", next);
  };

  const moveActiveBranch = (offset: -1 | 1, moveFocus: boolean) => {
    const keys = branchKeys(latestCardRef.current);
    if (keys.length === 0) return;
    const current = activeKey ? keys.indexOf(activeKey) : -1;
    const next = keys[Math.min(Math.max(current + offset, 0), keys.length - 1)];
    if (!next) return;
    setActiveKey(next);
    if (moveFocus) focusRow("branch", next);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const rowKind = target.dataset.workspaceRow;
    const isFilter = target.tagName === "INPUT" || target.tagName === "TEXTAREA";
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (pane === "branches") {
        setPane("projects");
        focusRow("project", browsedProjectPath);
        return;
      }
      closeAndFocusTrigger();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const offset = event.key === "ArrowDown" ? 1 : -1;
      if (pane === "projects") {
        event.preventDefault();
        moveBrowsed(offset);
        return;
      }
      if (rowKind || isFilter) {
        event.preventDefault();
        moveActiveBranch(offset, Boolean(rowKind));
      }
      return;
    }
    if (event.key === "ArrowRight") {
      if (pane !== "projects") return;
      event.preventDefault();
      setPane("branches");
      if (latestCardRef.current.pane.state === "ready") focusRow("branch", activeKey ?? "");
      else
        [
          ...(rootRef.current?.querySelectorAll<HTMLElement>('[data-workspace-action="switch-project"]') ?? []),
        ][0]?.focus();
      return;
    }
    if (event.key === "ArrowLeft") {
      if (pane !== "branches") return;
      event.preventDefault();
      setPane("projects");
      focusRow("project", browsedProjectPath);
      return;
    }
    if (event.key === "Enter") {
      if (rowKind === "project") {
        event.preventDefault();
        card.activateProject(target.dataset.workspaceKey ?? "");
        return;
      }
      if (rowKind === "branch") {
        event.preventDefault();
        card.activateBranch(target.dataset.workspaceKey ?? "");
        return;
      }
      if (isFilter && activeKey) {
        event.preventDefault();
        card.activateBranch(activeKey);
      }
    }
  };

  const runAction = (action: () => Promise<void>, failure: (error: unknown) => string) => {
    setActionError(null);
    void action().then(onRequestClose, (error: unknown) => setActionError(failure(error)));
  };

  const message = actionError ?? card.error;
  const hints =
    pane === "branches" || card.pane.state !== "not-repo"
      ? [
          { key: "↑↓", label: t("hintSelect", "Select") },
          { key: "←→", label: t("hintSwitchPane", "Switch pane") },
          { key: "↵", label: t("hintSwitch", "Switch") },
        ]
      : [
          { key: "↑↓", label: t("hintSelect", "Select") },
          { key: "↵", label: t("hintSwitch", "Switch") },
          { key: "esc", label: t("hintClose", "Close") },
        ];

  return (
    <div
      id={id}
      ref={rootRef}
      role="group"
      aria-label={t("workspaceMenu", "Workspace")}
      onKeyDown={handleKeyDown}
      className="composer-pop-in workspace-card"
      style={{
        position: "absolute",
        left: 0,
        bottom: CARD_ABOVE_TRIGGER,
        zIndex: 130,
        width: isMobile ? "calc(100vw - 16px)" : CARD_WIDTH,
        maxWidth: CARD_WIDTH,
        maxHeight: position.maxHeight,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        background: SURFACE_RAISED,
        border: "1px solid var(--fx-line-default)",
        borderRadius: "var(--radius-menu)",
        boxShadow: "var(--shadow-picker)",
        overflow: "hidden",
        outline: "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "stretch", minHeight: 0, flex: "1 1 auto" }}>
        <div style={{ display: "flex", minWidth: 0 }} onFocus={() => setPane("projects")}>
          <WorkspaceProjectList
            projects={card.projects}
            onActivate={card.activateProject}
            onBrowse={card.browseProject}
          />
        </div>
        <div style={{ display: "flex", flex: 1, minWidth: 0 }} onFocus={() => setPane("branches")}>
          <WorkspaceBranchList
            card={card}
            activeKey={activeKey ?? ""}
            onActivateRow={card.activateBranch}
            onFocusRow={setActiveKey}
            onSwitchToProject={() => (browsedProjectPath ? card.activateProject(browsedProjectPath) : undefined)}
          />
        </div>
      </div>

      {card.blocked ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 10px 10px 14px",
            borderTop: "1px solid var(--fx-status-warning-border)",
            background: "var(--fx-status-warning-soft)",
            flexShrink: 0,
          }}
        >
          <span style={{ display: "flex", flexShrink: 0, color: "var(--fx-status-warning)" }}>
            <ActivityGlyph size={14} />
          </span>
          <span style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
            <span className="type-body-medium" style={{ color: "var(--fx-status-warning-text)" }}>
              {card.blocked.title}
            </span>
            <span className="type-meta-default" style={{ color: "var(--fx-text-secondary)" }}>
              {card.blocked.detail}
            </span>
          </span>
          <button
            type="button"
            onClick={card.dismissBlocked}
            className="type-label-default"
            style={{ ...FOOTER_BUTTON, height: 28, flexShrink: 0, color: "var(--fx-text-body)" }}
            onMouseEnter={(event) => paint(event, HOVER)}
            onMouseLeave={(event) => paint(event, CLEAR)}
          >
            {t("cancel", "Cancel")}
          </button>
          <button
            type="button"
            onClick={card.openBlockedInNewWorktree}
            disabled={card.busy}
            className="type-label-medium"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              height: 28,
              padding: "0 10px",
              flexShrink: 0,
              border: "none",
              borderRadius: "var(--radius-control)",
              background: "var(--fx-accent-blue-fill)",
              color: "var(--fx-text-on-accent)",
              cursor: card.busy ? "not-allowed" : "pointer",
              outline: "none",
              opacity: card.busy ? 0.65 : 1,
            }}
          >
            <span style={{ display: "flex", flexShrink: 0 }}>
              <FolderGitGlyph size={13} />
            </span>
            {t("openInNewWorktree", "Open in new worktree")}
          </button>
        </div>
      ) : (
        <>
          {message && (
            <div
              role="alert"
              className="type-meta-default"
              style={{
                padding: "4px 8px",
                flexShrink: 0,
                color: "var(--fx-status-danger-text)",
                overflowWrap: "anywhere",
              }}
            >
              {message}
            </div>
          )}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              flexShrink: 0,
              padding: "6px 8px 6px 6px",
              borderTop: "1px solid var(--fx-line-default)",
            }}
          >
            <button
              type="button"
              onClick={() =>
                runAction(workspace.openInFinder, (error) => (error instanceof Error ? error.message : String(error)))
              }
              style={{ ...FOOTER_BUTTON, color: "var(--fx-text-body)" }}
              className="type-label-default"
              onMouseEnter={(event) => paint(event, HOVER)}
              onMouseLeave={(event) => paint(event, CLEAR)}
            >
              <span style={{ display: "flex", flexShrink: 0, color: "var(--fx-text-secondary)" }}>
                <ExternalLinkGlyph size={13} />
              </span>
              {revealLabel}
            </button>
            <button
              type="button"
              onClick={() => runAction(workspace.copyPath, () => t("copyFailed", "Copy failed"))}
              style={{ ...FOOTER_BUTTON, color: "var(--fx-text-body)" }}
              className="type-label-default"
              onMouseEnter={(event) => paint(event, HOVER)}
              onMouseLeave={(event) => paint(event, CLEAR)}
            >
              <span style={{ display: "flex", flexShrink: 0, color: "var(--fx-text-secondary)" }}>
                <CopyGlyph size={13} />
              </span>
              {t("copyPath", "Copy path")}
            </button>
            <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
              {hints.map((hint) => (
                <KeyHint key={hint.key} keyLabel={hint.key} label={hint.label} />
              ))}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
