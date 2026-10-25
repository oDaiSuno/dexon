import type { GitStatusResult } from "@shared/api-types";
import { gitEntryKind } from "@shared/git-status";

export type FileChange = "staged" | "modified" | "untracked" | "conflicted";
export type FolderChange = "changed" | "untracked" | "conflicted";

export interface FileMark {
  change: FileChange;
  letter: string;
}

export interface GitTreeMarks {
  file(relativePath: string): FileMark | null;
  folder(relativePath: string): FolderChange | null;
}

const NO_MARKS: GitTreeMarks = {
  file: () => null,
  folder: () => null,
};

const FOLDER_SEVERITY: Record<FolderChange, number> = { untracked: 1, changed: 2, conflicted: 3 };

function folderChangeOfFile(change: FileChange): FolderChange {
  if (change === "conflicted") return "conflicted";
  if (change === "untracked") return "untracked";
  return "changed";
}

function ancestorsOf(path: string): string[] {
  const segments = path.split("/");
  const prefixes: string[] = [];
  for (let index = 1; index < segments.length; index += 1) prefixes.push(segments.slice(0, index).join("/"));
  return prefixes;
}

function keepMostSevere(folders: Map<string, FolderChange>, path: string, change: FolderChange) {
  const known = folders.get(path);
  if (known && FOLDER_SEVERITY[known] >= FOLDER_SEVERITY[change]) return;
  folders.set(path, change);
}

export function gitTreeMarks(status: GitStatusResult | null): GitTreeMarks {
  if (!status || !status.isGit || status.entries.length === 0) return NO_MARKS;

  const files = new Map<string, FileMark>();
  const untrackedFolders = new Set<string>();
  const folders = new Map<string, FolderChange>();

  for (const entry of status.entries) {
    const kind = gitEntryKind(entry);
    const isUntrackedFolder = entry.path.endsWith("/");
    const path = isUntrackedFolder ? entry.path.slice(0, -1) : entry.path;

    let mark: FileMark;
    if (kind === "conflicted") mark = { change: "conflicted", letter: "!" };
    else if (kind === "untracked") mark = { change: "untracked", letter: "U" };
    else if (entry.workingTree !== " ") mark = { change: "modified", letter: entry.workingTree };
    else mark = { change: "staged", letter: entry.index };

    if (isUntrackedFolder) untrackedFolders.add(path);
    else files.set(path, mark);

    const folderChange = folderChangeOfFile(mark.change);
    for (const ancestor of ancestorsOf(path)) keepMostSevere(folders, ancestor, folderChange);
    if (isUntrackedFolder) keepMostSevere(folders, path, "untracked");
  }

  const isUntrackedByAncestor = (path: string) =>
    untrackedFolders.has(path) || ancestorsOf(path).some((ancestor) => untrackedFolders.has(ancestor));

  return {
    file(relativePath) {
      const mark = files.get(relativePath);
      if (mark) return mark;
      return isUntrackedByAncestor(relativePath) ? { change: "untracked", letter: "U" } : null;
    },
    folder(relativePath) {
      const change = folders.get(relativePath);
      if (change) return change;
      return isUntrackedByAncestor(relativePath) ? "untracked" : null;
    },
  };
}
