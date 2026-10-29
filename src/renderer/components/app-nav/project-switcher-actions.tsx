import type { SwitcherRow } from "./project-switcher-parts";
import { FOLDER_PATH, HOUSE_PATHS, MenuIcon } from "./project-switcher-parts";

export function spaceActions({
  labels,
  mac,
  onChooseFolder,
  onBackToPersonalSpace,
}: {
  labels: { add: string; back: string };
  mac: boolean;
  onChooseFolder: () => void;
  onBackToPersonalSpace: () => void;
}): SwitcherRow[] {
  return [
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
}
