import type { GitStatusEntry, GitStatusResult } from "@shared/api-types";
import { gitEntryKind } from "@shared/git-status";

export const FILE_CHANGES = ["staged", "modified", "untracked", "conflicted"] as const;
export type FileChange = (typeof FILE_CHANGES)[number];
export type FolderChange = "changed" | "untracked" | "conflicted";
export type Translate = (key: string, fallback: string) => string;

export interface FileMark {
  change: FileChange;
  letter: string;
}

export interface ChangeRow {
  path: string;
  letter: string;
  isFolder: boolean;
}

export interface ChangeGroup {
  change: FileChange;
  rows: ChangeRow[];
}

export interface GitTreeMarks {
  file(relativePath: string): FileMark | null;
  folder(relativePath: string): FolderChange | null;
}

export const CHANGE_SWATCH_COLOR: Record<FileChange, string> = {
  staged: "var(--fx-status-success)",
  modified: "var(--fx-status-warning)",
  untracked: "var(--fx-text-faint)",
  conflicted: "var(--fx-status-danger)",
};

export const CHANGE_LETTER_CLASS: Record<FileChange, string> = {
  staged: "text-[var(--fx-status-success-text)]",
  modified: "text-[var(--fx-status-warning-text)]",
  untracked: "text-[var(--fx-text-tertiary)]",
  conflicted: "text-[var(--fx-status-danger-text)]",
};

const NO_MARKS: GitTreeMarks = {
  file: () => null,
  folder: () => null,
};

const FOLDER_SEVERITY: Record<FolderChange, number> = { untracked: 1, changed: 2, conflicted: 3 };

export function fileChangeLabel(t: Translate, change: FileChange): string {
  if (change === "staged") return t("gitStaged", "Staged");
  if (change === "modified") return t("gitModified", "Modified");
  if (change === "untracked") return t("gitUntracked", "Untracked");
  return t("gitConflicted", "Conflicted");
}

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

function entryMarks(entry: GitStatusEntry): FileMark[] {
  const kind = gitEntryKind(entry);
  if (kind === "conflicted") return [{ change: "conflicted", letter: "!" }];
  if (kind === "untracked") return [{ change: "untracked", letter: "U" }];
  const marks: FileMark[] = [];
  if (entry.index !== " ") marks.push({ change: "staged", letter: entry.index });
  if (entry.workingTree !== " ") marks.push({ change: "modified", letter: entry.workingTree });
  return marks;
}

function entryPaths(entry: GitStatusEntry): { path: string; isFolder: boolean } {
  const isFolder = entry.path.endsWith("/");
  return { path: isFolder ? entry.path.slice(0, -1) : entry.path, isFolder };
}

export function gitChangeGroups(status: GitStatusResult | null): ChangeGroup[] {
  if (!status || !status.isGit || status.entries.length === 0) return [];

  const buckets = new Map<FileChange, ChangeRow[]>(FILE_CHANGES.map((change) => [change, []]));

  for (const entry of status.entries) {
    const { path, isFolder } = entryPaths(entry);
    for (const mark of entryMarks(entry)) {
      buckets.get(mark.change)?.push({ path, letter: mark.letter, isFolder });
    }
  }

  return FILE_CHANGES.flatMap((change) => {
    const rows = buckets.get(change) ?? [];
    return rows.length === 0 ? [] : [{ change, rows }];
  });
}

export function gitTreeMarks(status: GitStatusResult | null): GitTreeMarks {
  if (!status || !status.isGit || status.entries.length === 0) return NO_MARKS;

  const files = new Map<string, FileMark>();
  const untrackedFolders = new Set<string>();
  const folders = new Map<string, FolderChange>();

  for (const entry of status.entries) {
    const { path, isFolder } = entryPaths(entry);
    const marks = entryMarks(entry);
    const mark = marks.find((item) => item.change === "modified") ?? marks[0];
    if (!mark) continue;

    if (isFolder) untrackedFolders.add(path);
    else files.set(path, mark);

    const folderChange = folderChangeOfFile(mark.change);
    for (const ancestor of ancestorsOf(path)) keepMostSevere(folders, ancestor, folderChange);
    if (isFolder) keepMostSevere(folders, path, "untracked");
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
