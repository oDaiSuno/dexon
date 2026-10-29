import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/i18n";
import { abbreviateHomePath } from "@/lib/display-path";
import { subscribeProjectSwitcherRequest } from "@/lib/project-switcher-request";
import { getParentFilePath } from "@shared/file-paths";
import { ProjectSwitcherCard, type SwitcherProject } from "./project-switcher-card";
import { useAnchoredPopover } from "./use-anchored-popover";
import { HeaderButton, PlusGlyph } from "./section-header-buttons";

const CARD_WIDTH = 280;

export function ProjectSwitcherPopover({
  spaceName,
  projectPath,
  homeDir,
  projects,
  inspectFolder,
  onOpenFolder,
  onChooseFolder,
  onBackToPersonalSpace,
}: {
  spaceName: string;
  projectPath: string;
  homeDir: string;
  projects: readonly SwitcherProject[];
  inspectFolder?: (typed: string) => Promise<string | null>;
  onOpenFolder?: (folder: string) => void;
  onChooseFolder: () => void;
  onBackToPersonalSpace: () => void;
}) {
  const { t } = useI18n();
  const popover = useAnchoredPopover(CARD_WIDTH);
  const showRef = useRef(popover.show);
  showRef.current = popover.show;

  useEffect(() => subscribeProjectSwitcherRequest(() => showRef.current()), []);

  return (
    <>
      <HeaderButton
        ref={popover.triggerRef}
        label={t("switchOrAddProject", "Switch or add project")}
        pressed={popover.open}
        hasPopup
        onClick={() => (popover.open ? popover.close() : popover.show())}
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
            className="composer-pop-in"
            onKeyDown={(event) => popover.closeOnEscapeOrTab(event)}
            style={{
              position: "fixed",
              display: "flex",
              flexDirection: "column",
              gap: 2,
              width: CARD_WIDTH,
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
            <ProjectSwitcherCard
              spaceName={spaceName}
              folderPath={abbreviateHomePath(getParentFilePath(projectPath), homeDir)}
              homeDir={homeDir}
              projects={projects}
              inspectFolder={inspectFolder}
              onOpenFolder={onOpenFolder}
              onChooseFolder={onChooseFolder}
              onBackToPersonalSpace={onBackToPersonalSpace}
              onChoose={popover.choose}
            />
          </div>,
          document.body,
        )}
    </>
  );
}
