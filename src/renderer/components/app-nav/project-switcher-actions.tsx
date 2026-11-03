import type { SwitcherRow } from "./project-switcher-parts";
import { FOLDER_PATH, HOUSE_PATHS, MenuIcon } from "./project-switcher-parts";

export function spaceActions({
  labels,
  mac,
  onChooseFolder,
  onConnect,
  onBackToPersonalSpace,
}: {
  labels: { add: string; back: string; connect?: string };
  mac: boolean;
  onChooseFolder: () => void;
  onConnect?: () => void;
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
    ...(onConnect && labels.connect
      ? [
          {
            key: "connect-ssh",
            label: labels.connect,
            icon: (
              <MenuIcon>
                <path d="m5 7 5 5-5 5M13 17h6" />
              </MenuIcon>
            ),
            keepOpen: true,
            run: onConnect,
          },
        ]
      : []),
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
