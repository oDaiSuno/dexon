import { realpathSync } from "node:fs";
import { resolveProject } from "../../shared/worktree";
import { worktreePathsEqual } from "../../shared/worktree-path";

export async function projectRootOf(cwd: string | undefined): Promise<string | undefined> {
  if (!cwd) return undefined;
  return (await resolveProject(cwd)).projectRoot;
}

export function sameProjectRoot(left: string, right: string): boolean {
  return worktreePathsEqual(canonicalRoot(left), canonicalRoot(right));
}

function canonicalRoot(root: string): string {
  try {
    return realpathSync.native(root);
  } catch {
    return root;
  }
}
