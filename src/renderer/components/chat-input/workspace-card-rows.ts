import type { WorktreeBranchesResult } from "@shared/api-types";
import { worktreePathsEqual } from "@shared/worktree-path";
import { abbreviateHomePath } from "@/lib/display-path";
import { formatRelativeCommitTime } from "@/lib/locale-format";
import type { AppLanguage } from "@/i18n";
import type { ComposerCardBranch, ComposerCardSections, ComposerCheckout } from "./types";

export interface BlockedRow {
  branch: string;
  projectPath: string;
}

function row(props: ComposerCardBranch): ComposerCardBranch {
  return props;
}

function label(folder: string | null, homeDir: string): string | null {
  return folder ? abbreviateHomePath(folder, homeDir) : null;
}

function isBlockedRow(blocked: BlockedRow | null, folder: string, name: string): boolean {
  if (!blocked) return false;
  return blocked.branch === name && worktreePathsEqual(blocked.projectPath, folder);
}

function matchesFilter(name: string, filter: string): boolean {
  const needle = filter.trim().toLowerCase();
  return !needle || name.toLowerCase().includes(needle);
}

export function branchSections({
  listing,
  folder,
  blocked,
  filter,
  language,
  homeDir,
  now = Date.now(),
}: {
  listing: WorktreeBranchesResult;
  folder: string;
  blocked: BlockedRow | null;
  filter: string;
  language: AppLanguage;
  homeDir: string;
  now?: number;
}): { sections: ComposerCardSections; count: number } {
  const branches = listing.branches;
  const detachedAtCwd = listing.detached.find((entry) => worktreePathsEqual(entry.path, folder));

  const current: ComposerCardBranch[] = [];
  for (const entry of branches) {
    if (!entry.isCurrent) continue;
    current.push(
      row({
        key: `branch:${entry.name}`,
        name: entry.name,
        kind: "current",
        identity: entry.isMainFolder ? "branch" : "worktree",
        path: entry.worktreePath,
        pathLabel: label(entry.worktreePath, homeDir),
        isMainFolder: entry.isMainFolder,
        timeLabel: null,
        blocked: isBlockedRow(blocked, folder, entry.name),
        disabled: false,
        removable: Boolean(entry.worktreePath && !entry.isMainFolder),
      }),
    );
  }
  if (current.length === 0 && detachedAtCwd) {
    current.push(
      row({
        key: `detached:${detachedAtCwd.path}`,
        name: detachedAtCwd.commit,
        kind: "current",
        identity: "detached",
        path: detachedAtCwd.path,
        pathLabel: label(detachedAtCwd.path, homeDir),
        isMainFolder: false,
        timeLabel: null,
        blocked: false,
        disabled: false,
        removable: true,
      }),
    );
  }

  const folders: ComposerCardBranch[] = [];
  for (const entry of branches) {
    if (entry.isCurrent || !entry.worktreePath) continue;
    folders.push(
      row({
        key: `branch:${entry.name}`,
        name: entry.name,
        kind: "folder",
        identity: entry.isMainFolder ? "branch" : "worktree",
        path: entry.worktreePath,
        pathLabel: label(entry.worktreePath, homeDir),
        isMainFolder: entry.isMainFolder,
        timeLabel: null,
        blocked: isBlockedRow(blocked, folder, entry.name),
        disabled: false,
        removable: !entry.isMainFolder,
      }),
    );
  }
  for (const entry of listing.detached) {
    if (detachedAtCwd && worktreePathsEqual(entry.path, detachedAtCwd.path)) continue;
    folders.push(
      row({
        key: `detached:${entry.path}`,
        name: entry.commit,
        kind: "detached",
        identity: "detached",
        path: entry.path,
        pathLabel: label(entry.path, homeDir),
        isMainFolder: false,
        timeLabel: null,
        blocked: false,
        disabled: false,
        removable: true,
      }),
    );
  }

  const others: ComposerCardBranch[] = [];
  const stale: ComposerCardBranch[] = [];
  for (const entry of branches) {
    if (entry.isCurrent || entry.worktreePath) continue;
    if (entry.stalePath) {
      stale.push(
        row({
          key: `stale:${entry.name}`,
          name: entry.name,
          kind: "stale",
          identity: "stale",
          path: entry.stalePath,
          pathLabel: label(entry.stalePath, homeDir),
          isMainFolder: false,
          timeLabel: null,
          blocked: false,
          disabled: true,
          removable: false,
        }),
      );
      continue;
    }
    others.push(
      row({
        key: `branch:${entry.name}`,
        name: entry.name,
        kind: "local",
        identity: "branch",
        path: null,
        pathLabel: null,
        isMainFolder: false,
        timeLabel: formatRelativeCommitTime(entry.committedAt, language, now),
        blocked: isBlockedRow(blocked, folder, entry.name),
        disabled: false,
        removable: false,
      }),
    );
  }

  const filterRows = (rows: ComposerCardBranch[]) => rows.filter((entry) => matchesFilter(entry.name, filter));
  const count = current.length + folders.length + others.length + stale.length;
  return {
    sections: {
      current: filterRows(current),
      folders: filterRows(folders),
      others: filterRows(others),
      stale: filterRows(stale),
    },
    count,
  };
}

export function checkoutSections({
  checkouts,
  selectedCwd,
  blocked,
  homeDir = "",
}: {
  checkouts: ComposerCheckout[];
  selectedCwd: string | null;
  blocked: BlockedRow | null;
  homeDir?: string;
}): ComposerCardSections {
  const currentEntry =
    (selectedCwd ? checkouts.find((entry) => worktreePathsEqual(entry.path, selectedCwd)) : undefined) ??
    checkouts.find((entry) => entry.isMain) ??
    null;
  const current: ComposerCardBranch[] =
    currentEntry === null
      ? []
      : [
          row({
            key: `checkout:${currentEntry.path}`,
            name: currentEntry.branch ?? currentEntry.path,
            kind: "current",
            identity: currentEntry.isMain ? "branch" : "worktree",
            path: currentEntry.path,
            pathLabel: label(currentEntry.path, homeDir),
            isMainFolder: currentEntry.isMain,
            timeLabel: null,
            blocked: false,
            disabled: false,
            removable: !currentEntry.isMain,
          }),
        ];
  const folders: ComposerCardBranch[] = checkouts
    .filter((entry) => entry !== currentEntry)
    .map((entry) =>
      row({
        key: `checkout:${entry.path}`,
        name: entry.branch ?? entry.path,
        kind: "folder",
        identity: entry.isMain ? "branch" : "worktree",
        path: entry.path,
        pathLabel: label(entry.path, homeDir),
        isMainFolder: entry.isMain,
        timeLabel: null,
        blocked: Boolean(blocked && blocked.branch === (entry.branch ?? entry.path)),
        disabled: false,
        removable: !entry.isMain,
      }),
    );
  return { current, folders, others: [], stale: [] };
}
