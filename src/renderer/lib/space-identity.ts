import { getFileName, getParentFilePath, joinFilePath } from "@shared/file-paths";
import { worktreePathsEqual } from "@shared/worktree-path";

const PERSONAL_FOLDER_NAME = ".dexon";

export function isPersonalSpace(path: string, personalCwd: string | null, homeDir: string): boolean {
  if (personalCwd) return worktreePathsEqual(path, personalCwd);
  if (!homeDir || getFileName(path) !== PERSONAL_FOLDER_NAME) return false;
  return worktreePathsEqual(getParentFilePath(path), homeDir);
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
