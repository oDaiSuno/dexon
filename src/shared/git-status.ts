import type { GitStatusEntry, GitStatusResult } from "./api-types";

export type GitEntryKind = "untracked" | "conflicted" | "tracked";

const CONFLICT_CODES = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

export function gitEntryKind(entry: GitStatusEntry): GitEntryKind {
  const code = `${entry.index}${entry.workingTree}`;
  if (code === "??") return "untracked";
  if (CONFLICT_CODES.has(code) || entry.index === "U" || entry.workingTree === "U") return "conflicted";
  return "tracked";
}

export function parseGitStatusPorcelain(output: string, branch: string | null): GitStatusResult {
  const entries: GitStatusEntry[] = [];
  const records = output.split("\0");
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || record.length < 4 || record[2] !== " ") continue;
    const indexState = record[0];
    const workingTree = record[1];
    entries.push({ path: record.slice(3), index: indexState, workingTree });
    // Porcelain -z emits the original path as a second record for rename/copy.
    if (indexState === "R" || indexState === "C") index += 1;
  }

  let staged = 0;
  let modified = 0;
  let untracked = 0;
  let conflicted = 0;
  for (const entry of entries) {
    const kind = gitEntryKind(entry);
    if (kind === "untracked") untracked += 1;
    else if (kind === "conflicted") conflicted += 1;
    else {
      if (entry.index !== " ") staged += 1;
      if (entry.workingTree !== " ") modified += 1;
    }
  }

  return {
    isGit: true,
    branch,
    clean: entries.length === 0,
    staged,
    modified,
    untracked,
    conflicted,
    entries,
  };
}
