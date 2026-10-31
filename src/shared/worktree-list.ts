import { existsSync } from "fs";
import { normalizeWorktreePathForComparison } from "./worktree-path.ts";

export interface ParsedWorktree {
  path: string;
  branch: string | null;
  head: string | null;
  detached: boolean;
  isMain: boolean;
  stale: boolean;
}

export function parseWorktreeList(out: string): ParsedWorktree[] {
  const blocks: string[][] = [];
  let block: string[] = [];
  for (const line of out.split("\n")) {
    if (line.trim() === "") {
      if (block.length > 0) blocks.push(block);
      block = [];
      continue;
    }
    block.push(line);
  }
  if (block.length > 0) blocks.push(block);

  const entries: ParsedWorktree[] = [];
  for (const lines of blocks) {
    const pathLine = lines.find((line) => line.startsWith("worktree "));
    if (!pathLine) continue;
    const path = pathLine.slice("worktree ".length).trim();
    const branchLine = lines.find((line) => line.startsWith("branch "));
    const headLine = lines.find((line) => line.startsWith("HEAD "));
    entries.push({
      path,
      branch: branchLine
        ? branchLine
            .slice("branch ".length)
            .trim()
            .replace(/^refs\/heads\//, "")
        : null,
      head: headLine ? headLine.slice("HEAD ".length).trim() : null,
      detached: lines.includes("detached"),
      isMain: entries.length === 0,
      stale: lines.some((line) => line.startsWith("prunable")) || !existsSync(path),
    });
  }
  return entries;
}

export function folderContains(
  parent: string,
  candidate: string,
  platform: NodeJS.Platform | "" | undefined = undefined,
): boolean {
  const normalizedParent = normalizeWorktreePathForComparison(parent, platform);
  const normalizedCandidate = normalizeWorktreePathForComparison(candidate, platform);
  if (normalizedCandidate === normalizedParent) return true;
  const withSeparator = normalizedParent.endsWith("/") ? normalizedParent : `${normalizedParent}/`;
  return normalizedCandidate.startsWith(withSeparator);
}
