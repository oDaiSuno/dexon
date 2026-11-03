import {
  encodeFilePathForApi as encodeLocalFilePathForApi,
  getFileName as getLocalFileName,
  getParentFilePath as getLocalParentFilePath,
  getRelativeFilePath as getLocalRelativeFilePath,
  joinFilePath as joinLocalFilePath,
} from "@shared/file-paths";
import {
  describeWorkspaceKey,
  fromKey,
  joinWorkspaceKeyPath,
  keyOf,
  normalizePosixPath,
  relativeWorkspacePath,
} from "@shared/workspace-ref";

export * from "@shared/file-paths";

export function encodeFilePathForApi(filePath: string): string {
  return describeWorkspaceKey(filePath).isSsh ? encodeURIComponent(filePath) : encodeLocalFilePathForApi(filePath);
}

export function getFileName(filePath: string): string {
  return getLocalFileName(describeWorkspaceKey(filePath).displayPath);
}

export function getParentFilePath(filePath: string): string {
  const parsed = fromKey(filePath);
  return parsed.ok && parsed.value.kind === "ssh"
    ? keyOf({ ...parsed.value, root: normalizePosixPath(getLocalParentFilePath(parsed.value.root) || "/") })
    : getLocalParentFilePath(filePath);
}

export function getRelativeFilePath(filePath: string, cwd?: string): string {
  return cwd && describeWorkspaceKey(cwd).isSsh
    ? (relativeWorkspacePath(cwd, filePath) ?? filePath)
    : getLocalRelativeFilePath(filePath, cwd);
}

export function joinFilePath(parent: string, child: string): string {
  return describeWorkspaceKey(parent).isSsh ? joinWorkspaceKeyPath(parent, child) : joinLocalFilePath(parent, child);
}
