import { sessionProjectKey } from "@/lib/session-list";
import type { ListedProject } from "./nav-history";
import { NavSpaceMenu } from "./nav-space-menu";
import type { SwitcherProject } from "./project-switcher-card";

export function ProjectRowActions({
  name,
  revealed,
  project,
  switchTargets,
  currentProject,
  homeDir,
  runningProjectKeys,
  isDefaultProject,
  canMoveProject,
  onMoveProject,
  onCloseProject,
  onOpenFolder,
  inspectFolder,
  onChooseFolder,
  onBackToPersonalSpace,
}: {
  name: string;
  revealed: boolean;
  project: ListedProject;
  switchTargets: readonly SwitcherProject[];
  currentProject?: string;
  homeDir: string;
  runningProjectKeys: ReadonlySet<string>;
  isDefaultProject?: (root: string) => boolean;
  canMoveProject?: (root: string, offset: -1 | 1) => boolean;
  onMoveProject?: (root: string, offset: -1 | 1) => void;
  onCloseProject?: (root: string) => void;
  onOpenFolder?: (folder: string) => void;
  inspectFolder?: (typed: string) => Promise<string | null>;
  onChooseFolder: () => void;
  onBackToPersonalSpace: () => void;
}) {
  const key = sessionProjectKey(project.root);
  const currentRow = sessionProjectKey(currentProject ?? "") === key;
  const isDefault = isDefaultProject?.(project.root) ?? false;
  const closable = !isDefault && !runningProjectKeys.has(key);
  return (
    <NavSpaceMenu
      spaceName={name}
      projectPath={project.root}
      homeDir={homeDir}
      revealed={revealed}
      missing={project.missing}
      variant={currentRow || isDefault ? "card" : "menu"}
      currentRow={currentRow}
      projects={currentRow ? switchTargets : []}
      onOpenFolder={onOpenFolder}
      inspectFolder={inspectFolder}
      onChooseFolder={onChooseFolder}
      onBackToPersonalSpace={onBackToPersonalSpace}
      canMoveUp={canMoveProject?.(project.root, -1) ?? false}
      canMoveDown={canMoveProject?.(project.root, 1) ?? false}
      canClose={closable}
      onMoveUp={() => onMoveProject?.(project.root, -1)}
      onMoveDown={() => onMoveProject?.(project.root, 1)}
      onClose={() => onCloseProject?.(project.root)}
      closeProject={closable ? () => onCloseProject?.(project.root) : undefined}
    />
  );
}
