import { sessionProjectKey } from "@/lib/session-list";
import type { ListedProject } from "./nav-history";
import { NavSpaceMenu } from "./nav-space-menu";

export function ProjectRowActions({
  name,
  revealed,
  project,
  runningProjectKeys,
  isDefaultProject,
  canMoveProject,
  onMoveProject,
  onCloseProject,
}: {
  name: string;
  revealed: boolean;
  project: ListedProject;
  runningProjectKeys: ReadonlySet<string>;
  isDefaultProject?: (root: string) => boolean;
  canMoveProject?: (root: string, offset: -1 | 1) => boolean;
  onMoveProject?: (root: string, offset: -1 | 1) => void;
  onCloseProject?: (root: string) => void;
}) {
  if (isDefaultProject?.(project.root)) return null;
  return (
    <NavSpaceMenu
      spaceName={name}
      projectPath={project.root}
      revealed={revealed}
      missing={project.missing}
      canMoveUp={canMoveProject?.(project.root, -1) ?? false}
      canMoveDown={canMoveProject?.(project.root, 1) ?? false}
      canClose={!runningProjectKeys.has(sessionProjectKey(project.root))}
      onMoveUp={() => onMoveProject?.(project.root, -1)}
      onMoveDown={() => onMoveProject?.(project.root, 1)}
      onClose={() => onCloseProject?.(project.root)}
    />
  );
}
