import { useId, type ReactNode } from "react";
import { useI18n } from "@/i18n";
import type { ProjectSpaceRow } from "./project-space-rows";
import { projectMenuFor, type ProjectMenuAction } from "./project-menu-model";
import { ProjectMenuHeader } from "./project-menu-header";
import { FOLDER_PATH, MenuIcon } from "./project-switcher-parts";

function ActionGlyph({ action }: { action: ProjectMenuAction }) {
  const paths = {
    "new-session": "M12 5v14M5 12h14",
    "copy-path": "M9 9h12v12H9zM15 9V3H3v12h6",
    "server-settings": "M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5M14 3h7v7M21 3l-9 9",
    reveal: FOLDER_PATH,
    "move-up": "M12 19V5m-7 7 7-7 7 7",
    "move-down": "M12 5v14m7-7-7 7-7-7",
    remove: "M18 6 6 18M6 6l12 12",
  };
  return (
    <MenuIcon size={15} style={{ flexShrink: 0, color: "var(--fx-text-secondary)" }}>
      <path d={paths[action]} />
    </MenuIcon>
  );
}

function MenuItem({
  label,
  icon,
  disabled,
  reason,
  danger,
  onChoose,
}: {
  label: string;
  icon: ReactNode;
  disabled: boolean;
  reason?: string;
  danger?: boolean;
  onChoose: () => void;
}) {
  const reasonId = useId();
  return (
    <>
      <button
        type="button"
        role="menuitem"
        aria-label={label}
        aria-disabled={disabled ? true : undefined}
        aria-describedby={reason ? reasonId : undefined}
        title={reason}
        onClick={() => {
          if (!disabled) onChoose();
        }}
        className={`project-menu-item type-body-large${danger ? " project-menu-danger" : ""}`}
      >
        {icon}
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label}
        </span>
      </button>
      {reason && (
        <span id={reasonId} className="sr-only">
          {reason}
        </span>
      )}
    </>
  );
}

export function ProjectMenuContent({
  project,
  missing,
  canMoveUp,
  canMoveDown,
  canClose,
  onMoveUp,
  onMoveDown,
  onClose,
  onNewSession,
  onCopyPath,
  onOpenServerSettings,
  onReveal,
}: {
  project?: ProjectSpaceRow;
  missing: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canClose: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onClose: () => void;
  onNewSession?: () => void;
  onCopyPath?: () => void;
  onOpenServerSettings?: () => void;
  onReveal?: () => void;
}) {
  const { t } = useI18n();
  const model = project
    ? projectMenuFor(project, { canMoveUp, canMoveDown })
    : {
        remote: false,
        entries: [
          { action: "move-up" as const, disabled: !canMoveUp },
          { action: "move-down" as const, disabled: !canMoveDown },
          { action: "remove" as const, disabled: !canClose },
        ],
      };
  const labels: Record<ProjectMenuAction, string> = {
    "new-session": t("navProjectNewSession", "New session in this project"),
    "copy-path": t("navCopyRemotePath", "Copy remote path"),
    "server-settings": t("navProjectServerSettings", "Server connection settings…"),
    reveal: t("navProjectShowInFinder", "Show in Finder"),
    "move-up": t("moveProjectUp", "Move up"),
    "move-down": t("moveProjectDown", "Move down"),
    remove: model.remote
      ? t("navRemoveProjectSpace", "Remove project space from sidebar")
      : t("closeProject", "Close project"),
  };
  const run: Record<ProjectMenuAction, () => void> = {
    "new-session": () => onNewSession?.(),
    "copy-path": () => onCopyPath?.(),
    "server-settings": () => onOpenServerSettings?.(),
    reveal: () => onReveal?.(),
    "move-up": onMoveUp,
    "move-down": onMoveDown,
    remove: onClose,
  };
  return (
    <>
      {model.remote && project && <ProjectMenuHeader project={project} />}
      {missing && (
        <div className="type-label-default" style={{ padding: "10px 14px 6px", color: "var(--fx-text-secondary)" }}>
          {t("missingFolderNote", "This folder was moved or deleted. Its sessions are kept.")}
        </div>
      )}
      {model.entries.map((entry) => (
        <div key={entry.action}>
          {entry.action === "remove" && (
            <div aria-hidden="true" style={{ padding: "4px 6px" }}>
              <div style={{ height: 1, background: "var(--fx-line-default)" }} />
            </div>
          )}
          <MenuItem
            label={labels[entry.action]}
            icon={<ActionGlyph action={entry.action} />}
            disabled={entry.disabled}
            danger={model.remote && entry.action === "remove"}
            reason={
              entry.reason === "remote-folder"
                ? t("navRemoteFinderReason", "This folder is on a remote server. Copy its remote path instead.")
                : entry.reason === "unavailable"
                  ? t(
                      "navProjectUnavailableReason",
                      "Connect this server and check the project folder before starting a session.",
                    )
                  : undefined
            }
            onChoose={run[entry.action]}
          />
        </div>
      ))}
    </>
  );
}
