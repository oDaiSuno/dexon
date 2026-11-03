import { useEffect, useRef, useReducer } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/i18n";
import { abbreviateHomePath } from "@/lib/display-path";
import { subscribeProjectSwitcherRequest } from "@/lib/project-switcher-request";
import { getParentFilePath } from "@shared/file-paths";
import { ProjectSwitcherCard, type SwitcherProject } from "./project-switcher-card";
import { useAnchoredPopover } from "./use-anchored-popover";
import { HeaderButton, PlusGlyph } from "./section-header-buttons";
import { sshConnectReducer, type SshConnectServices } from "./ssh-connect-state";
import { SshConnectStepServers } from "./ssh-connect-step-servers";
import { SshConnectStepFolders } from "./ssh-connect-step-folders";

const CARD_WIDTH = 280;

export function ProjectSwitcherPopover({
  spaceName,
  projectPath,
  homeDir,
  projects,
  inspectFolder,
  remoteConnect,
  onOpenFolder,
  onChooseFolder,
  onBackToPersonalSpace,
}: {
  spaceName: string;
  projectPath: string;
  homeDir: string;
  projects: readonly SwitcherProject[];
  inspectFolder?: (typed: string) => Promise<string | null>;
  remoteConnect?: SshConnectServices;
  onOpenFolder?: (folder: string) => void;
  onChooseFolder: () => void;
  onBackToPersonalSpace: () => void;
}) {
  const { t } = useI18n();
  const [connect, dispatch] = useReducer(sshConnectReducer, { step: "list" });
  const width = Math.min(connect.step === "list" ? CARD_WIDTH : 420, window.innerWidth - 16);
  const popover = useAnchoredPopover(width);
  const showRef = useRef(popover.show);
  showRef.current = popover.show;

  useEffect(
    () =>
      subscribeProjectSwitcherRequest((request) => {
        dispatch({ type: request.mode === "ssh" ? "servers" : "list" });
        showRef.current();
      }),
    [],
  );

  return (
    <>
      <HeaderButton
        ref={popover.triggerRef}
        label={t("switchOrAddProject", "Switch or add project")}
        pressed={popover.open}
        hasPopup
        onClick={() => {
          if (popover.open) popover.close();
          else {
            dispatch({ type: "list" });
            popover.show();
          }
        }}
      >
        <PlusGlyph />
      </HeaderButton>
      {popover.position &&
        createPortal(
          <div
            ref={popover.popoverRef}
            role="menu"
            aria-label={spaceName}
            tabIndex={-1}
            className="composer-pop-in project-switcher-morph"
            onKeyDown={(event) => {
              if (popover.closeOnEscapeOrTab(event) || connect.step === "list") return;
              if (event.altKey && event.key === "ArrowLeft") {
                dispatch({ type: "list" });
                event.preventDefault();
                event.stopPropagation();
                return;
              }
              if ((event.target as HTMLElement).closest("input")) return;
              if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
              const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
              if (!buttons.length) return;
              const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End" || (current < 0 && event.key === "ArrowUp")
                    ? buttons.length - 1
                    : (current + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length;
              buttons[next].focus();
              event.preventDefault();
              event.stopPropagation();
            }}
            style={{
              position: "fixed",
              display: "flex",
              flexDirection: "column",
              gap: 2,
              width,
              padding: 6,
              zIndex: 1000,
              background: "var(--fx-surface-raised)",
              border: "1px solid var(--fx-line-default)",
              borderRadius: "var(--radius-dialog)",
              boxShadow: "var(--shadow-popover)",
              transformOrigin: "top right",
              ...popover.position,
            }}
          >
            {connect.step === "list" ? (
              <ProjectSwitcherCard
                spaceName={spaceName}
                folderPath={abbreviateHomePath(getParentFilePath(projectPath), homeDir)}
                homeDir={homeDir}
                projects={projects}
                inspectFolder={inspectFolder}
                onOpenFolder={onOpenFolder}
                onChooseFolder={onChooseFolder}
                onConnect={remoteConnect ? () => dispatch({ type: "servers" }) : undefined}
                onBackToPersonalSpace={onBackToPersonalSpace}
                onChoose={popover.choose}
              />
            ) : (
              <div key={connect.step} className="composer-pop-in project-switcher-step">
                <button
                  type="button"
                  className="type-label-medium"
                  aria-label={t("sshConnectBack", "Back to project list")}
                  aria-keyshortcuts="Alt+ArrowLeft"
                  onClick={() => dispatch({ type: "list" })}
                  style={{ padding: "8px 10px", color: "var(--fx-text-secondary)" }}
                >
                  ‹ {t("sshConnectBackLabel", "Back")}
                </button>
                {connect.step === "servers" && (
                  <SshConnectStepServers
                    state={connect}
                    dispatch={dispatch}
                    services={remoteConnect}
                    onOpenFolder={(folder) => popover.choose(() => onOpenFolder?.(folder))}
                  />
                )}
                {connect.step === "browse" && (
                  <SshConnectStepFolders
                    state={connect}
                    dispatch={dispatch}
                    services={remoteConnect}
                    onOpenFolder={(folder) => popover.choose(() => onOpenFolder?.(folder))}
                  />
                )}
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
