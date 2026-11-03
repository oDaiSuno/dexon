import { describeWorkspaceKey, fromKey, joinWorkspaceKeyPath, keyOf, normalizePosixPath } from "@shared/workspace-ref";
import { joinFilePath, normalizeFilePathSlashes } from "./file-paths";

export function toolFileReference(path: string, cwd?: string, homeDir?: string) {
  if (!path || /\p{Cc}/u.test(path)) return null;
  const workspace = fromKey(cwd ?? "");
  const remoteSession = workspace.ok && workspace.value.kind === "ssh";
  const home = homeDir ? normalizeFilePathSlashes(homeDir).replace(/\/$/, "") : null;
  const normalized = normalizeFilePathSlashes(path);
  const overlay =
    remoteSession &&
    (normalized === "~/.pi/agent" ||
      normalized.startsWith("~/.pi/agent/") ||
      (home && (normalized === `${home}/.pi/agent` || normalized.startsWith(`${home}/.pi/agent/`))));
  if (overlay) {
    if (path.startsWith("~/") && !homeDir) return null;
    return {
      path: path.startsWith("~/") ? joinFilePath(homeDir!, path.slice(2)) : path,
      space: "local-overlay" as const,
    };
  }
  const supplied = fromKey(path);
  if (supplied.ok && supplied.value.kind === "ssh") {
    return { path: keyOf(supplied.value), space: "remote" as const, hostLabel: describeWorkspaceKey(path).hostLabel! };
  }
  if (!supplied.ok && /^[A-Za-z][A-Za-z0-9+.-]*:/.test(path)) return null;
  if (remoteSession && (path.startsWith("\\") || (supplied.ok && !path.startsWith("/")))) return null;
  if (workspace.ok && workspace.value.kind === "ssh") {
    return {
      path: path.startsWith("/")
        ? keyOf({ ...workspace.value, root: normalizePosixPath(path) })
        : joinWorkspaceKeyPath(cwd!, path),
      space: "remote" as const,
      hostLabel: describeWorkspaceKey(cwd!).hostLabel!,
    };
  }
  return { path: supplied.ok ? path : cwd ? joinFilePath(cwd, path) : path, space: "local" as const };
}
