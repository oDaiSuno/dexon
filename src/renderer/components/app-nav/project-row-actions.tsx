import type { ProjectSpaceRow } from "./project-space-rows";
import type { ProjectSpaceRef } from "@shared/project-space-state";
import { NavSpaceMenu } from "./nav-space-menu";

export function ProjectRowActions({
  name,
  revealed,
  project,
  workInFlight,
  isDefaultProject,
  canMoveProject,
  onMoveProject,
  onCloseProject,
  onNewSession,
  onCopyPath,
  onRevealProject,
  onOpenServerSettings,
}: {
  name: string;
  revealed: boolean;
  project: ProjectSpaceRow;
  workInFlight: boolean;
  isDefaultProject?: (root: string) => boolean;
  canMoveProject?: (root: string, offset: -1 | 1, environmentId?: string) => boolean;
  onMoveProject?: (root: string, offset: -1 | 1, environmentId?: string) => void;
  onCloseProject?: (root: string, environmentId?: string) => void;
  onNewSession?: (space: ProjectSpaceRef) => void;
  onCopyPath?: (space: ProjectSpaceRef) => void;
  onRevealProject?: (space: ProjectSpaceRef) => void;
  onOpenServerSettings?: () => void;
}) {
  if (project.pinned || (project.environmentId === "primary" && isDefaultProject?.(project.root))) return null;
  return (
    <NavSpaceMenu
      project={project}
      onNewSession={() => onNewSession?.(project)}
      onCopyPath={() => onCopyPath?.(project)}
      onReveal={() => onRevealProject?.(project)}
      onOpenServerSettings={onOpenServerSettings}
      spaceName={name}
      projectPath={project.root}
      revealed={revealed}
      missing={project.missing}
      canMoveUp={canMoveProject?.(project.root, -1, project.environmentId) ?? false}
      canMoveDown={canMoveProject?.(project.root, 1, project.environmentId) ?? false}
      canClose={!workInFlight}
      onMoveUp={() => onMoveProject?.(project.root, -1, project.environmentId)}
      onMoveDown={() => onMoveProject?.(project.root, 1, project.environmentId)}
      onClose={() => onCloseProject?.(project.root, project.environmentId)}
    />
  );
}
