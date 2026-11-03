import type { ListedProject } from "./nav-history";
import { NavSpaceMenu } from "./nav-space-menu";
import type { RemoteProjectMenuProps } from "./remote-project-menu";

export function ProjectRowActions({
  name,
  revealed,
  project,
  workInFlight,
  isDefaultProject,
  canMoveProject,
  onMoveProject,
  onCloseProject,
  remote,
}: {
  name: string;
  revealed: boolean;
  project: ListedProject;
  workInFlight: boolean;
  isDefaultProject?: (root: string) => boolean;
  canMoveProject?: (root: string, offset: -1 | 1) => boolean;
  onMoveProject?: (root: string, offset: -1 | 1) => void;
  onCloseProject?: (root: string) => void;
  remote?: RemoteProjectMenuProps;
}) {
  if (isDefaultProject?.(project.root)) return null;
  return (
    <NavSpaceMenu
      spaceName={name}
      projectPath={project.root}
      revealed={revealed}
      remote={remote}
      missing={project.missing}
      canMoveUp={canMoveProject?.(project.root, -1) ?? false}
      canMoveDown={canMoveProject?.(project.root, 1) ?? false}
      canClose={!workInFlight}
      onMoveUp={() => onMoveProject?.(project.root, -1)}
      onMoveDown={() => onMoveProject?.(project.root, 1)}
      onClose={() => onCloseProject?.(project.root)}
    />
  );
}
