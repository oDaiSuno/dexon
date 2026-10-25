import type { DesktopMenuEvent } from "../contract/desktop";

export type DeveloperViewRole = "reload" | "forceReload" | "toggleDevTools";

export function developerViewRoles(isDev: boolean): DeveloperViewRole[] {
  return isDev ? ["reload", "forceReload", "toggleDevTools"] : [];
}

export type MenuShortcutCommand = { label: string; accelerator: string; event: DesktopMenuEvent };

export const viewShortcutCommands: MenuShortcutCommand[] = [
  { label: "Toggle Sidebar", accelerator: "CmdOrCtrl+\\", event: "toggle-sidebar" },
  { label: "Show Processes", accelerator: "CmdOrCtrl+J", event: "open-processes" },
];

export const fileShortcutCommands: MenuShortcutCommand[] = [
  { label: "Switch Project…", accelerator: "CmdOrCtrl+P", event: "open-project-switcher" },
  { label: "Add Project from Folder…", accelerator: "CmdOrCtrl+O", event: "add-project" },
];
