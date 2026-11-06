import type { SwitcherRow } from "./project-switcher-parts";
import { FOLDER_PATH, HOUSE_PATHS, MenuIcon } from "./project-switcher-parts";

export function projectSwitcherSources({
  labels,
  mac,
  onChooseFolder,
  onChooseRemoteFolder,
  onOpenServerSettings,
  onBackToPersonalSpace,
}: {
  labels: { add: string; remote: string; settings: string; online: string; settingsHint: string; back: string };
  mac: boolean;
  onChooseFolder: () => void;
  onChooseRemoteFolder?: () => void;
  onOpenServerSettings?: () => void;
  onBackToPersonalSpace: () => void;
}): SwitcherRow[] {
  const rows: SwitcherRow[] = [
    {
      key: "add-folder",
      label: labels.add,
      icon: (
        <MenuIcon>
          <path d={FOLDER_PATH} />
          <path d="M12 11v6M9 14h6" />
        </MenuIcon>
      ),
      shortcut: mac ? { label: "⌘O", aria: "Meta+O" } : { label: "Ctrl O", aria: "Control+O" },
      run: onChooseFolder,
    },
  ];
  if (onChooseRemoteFolder)
    rows.push({
      key: "add-remote",
      label: labels.remote,
      detail: labels.online,
      icon: (
        <MenuIcon>
          <rect x="3" y="3" width="18" height="7" rx="2" />
          <rect x="3" y="14" width="18" height="7" rx="2" />
          <path d="M7 6.5h.01M7 17.5h.01" />
        </MenuIcon>
      ),
      run: onChooseRemoteFolder,
    });
  if (onOpenServerSettings)
    rows.push({
      key: "server-settings",
      label: labels.settings,
      detail: labels.settingsHint,
      icon: (
        <MenuIcon>
          <path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5M14 3h7v7M21 3l-9 9" />
        </MenuIcon>
      ),
      run: onOpenServerSettings,
    });
  rows.push({
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
  });
  return rows;
}
