import type { SwitcherRow } from "./project-switcher-parts";
import { FOLDER_PATH, HOUSE_PATHS, MenuIcon } from "./project-switcher-parts";

export function spaceActions({
  labels,
  mac,
  canCloseProject,
  onChooseFolder,
  onBackToPersonalSpace,
  onCloseProject,
}: {
  labels: { add: string; back: string; close: string };
  mac: boolean;
  canCloseProject: boolean;
  onChooseFolder: () => void;
  onBackToPersonalSpace: () => void;
  onCloseProject?: () => void;
}): SwitcherRow[] {
  const actions: SwitcherRow[] = [
    {
      key: "add-folder",
      label: labels.add,
      icon: (
        <MenuIcon>
          <path d={FOLDER_PATH} />
          <path d="M12 11v6" />
          <path d="M9 14h6" />
        </MenuIcon>
      ),
      shortcut: mac ? { label: "⌘O", aria: "Meta+O" } : { label: "Ctrl O", aria: "Control+O" },
      run: onChooseFolder,
    },
    {
      key: "default-space",
      label: labels.back,
      icon: (
        <MenuIcon>
          {HOUSE_PATHS.map((d) => (
            <path key={d} d={d} />
          ))}
        </MenuIcon>
      ),
      run: onBackToPersonalSpace,
    },
  ];
  if (onCloseProject) {
    actions.push({
      key: "close-project",
      label: labels.close,
      icon: (
        <MenuIcon>
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </MenuIcon>
      ),
      disabled: !canCloseProject,
      run: onCloseProject,
    });
  }
  return actions;
}
