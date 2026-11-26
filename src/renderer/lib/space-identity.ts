import { getFileName, getParentFilePath, joinFilePath } from "@shared/file-paths";
import { worktreePathsEqual } from "@shared/worktree-path";

const PERSONAL_FOLDER_NAME = ".dexon";
const AUTOMATION_FOLDER_NAME = "automations";

export function isPersonalSpace(path: string, personalCwd: string | null, homeDir: string): boolean {
  if (personalCwd) return worktreePathsEqual(path, personalCwd);
  if (!homeDir || getFileName(path) !== PERSONAL_FOLDER_NAME) return false;
  return worktreePathsEqual(getParentFilePath(path), homeDir);
}

export function hasAutomationFolderShape(path: string): boolean {
  return getFileName(path) === AUTOMATION_FOLDER_NAME && getFileName(getParentFilePath(path)) === PERSONAL_FOLDER_NAME;
}

export function isAutomationSpace(path: string, automationCwd: string | null, homeDir: string): boolean {
  if (automationCwd && worktreePathsEqual(path, automationCwd)) return true;
  if (!homeDir || !hasAutomationFolderShape(path)) return false;
  return worktreePathsEqual(getParentFilePath(getParentFilePath(path)), homeDir);
}

export function automationSpaceFolder(automationCwd: string | null, personalCwd: string | null): string | null {
  if (automationCwd) return automationCwd;
  if (!personalCwd || getFileName(personalCwd) !== PERSONAL_FOLDER_NAME) return null;
  return joinFilePath(personalCwd, AUTOMATION_FOLDER_NAME);
}

export function defaultSpaceFolder(personalCwd: string | null, homeDir: string): string | null {
  if (personalCwd) return personalCwd;
  if (!homeDir) return null;
  return joinFilePath(homeDir, PERSONAL_FOLDER_NAME);
}

export function spaceFolderName(path: string): string {
  return getFileName(path) || path;
}

export function spaceDisplayName(
  path: string,
  personalCwd: string | null,
  homeDir: string,
  personalLabel: string,
): string {
  return isPersonalSpace(path, personalCwd, homeDir) ? personalLabel : spaceFolderName(path);
}
