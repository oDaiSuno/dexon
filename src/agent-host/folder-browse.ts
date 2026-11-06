import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { FolderEntry, FolderListing, GitHeadSummary } from "../contract/folder-browse.ts";
export async function readGitHead(directory: string): Promise<GitHeadSummary | null> {
  try {
    let gitDir = path.join(directory, ".git");
    if ((await stat(gitDir)).isFile()) {
      const gitfile = await readFile(gitDir, "utf8");
      const match = /^gitdir:\s*(.+)\s*$/u.exec(gitfile.trim());
      if (!match) return null;
      gitDir = path.resolve(directory, match[1]);
    }
    const head = (await readFile(path.join(gitDir, "HEAD"), "utf8")).trim();
    if (head.startsWith("ref: refs/heads/")) return { branch: head.slice(16), detached: false };
    return /^[a-f0-9]{40,64}$/iu.test(head) ? { branch: null, detached: true } : null;
  } catch {
    return null;
  }
}
export async function browseFolders(typed: string): Promise<FolderListing> {
  if (typeof typed !== "string" || typed.length > 4096 || /[\0\r\n]/u.test(typed))
    return { ok: false, path: "", error: "not-absolute" };
  const home = homedir();
  const expanded = typed === "~" ? home : /^~[\\/]/u.test(typed) ? path.join(home, typed.slice(2)) : typed;
  if (!path.isAbsolute(expanded)) return { ok: false, path: typed, error: "not-absolute" };
  try {
    const canonical = await realpath(expanded);
    if (!(await stat(canonical)).isDirectory()) return { ok: false, path: typed, error: "not-directory" };
    const children = (await readdir(expanded, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .sort((a, b) => a.name.localeCompare(b.name));
    const folders = await Promise.all(
      children.slice(0, 500).map(async (entry): Promise<FolderEntry | null> => {
        const displayPath = path.join(expanded, entry.name);
        try {
          if (!(await stat(displayPath)).isDirectory()) return null;
          const canonicalPath = await realpath(displayPath);
          return { name: entry.name, path: canonicalPath, displayPath, git: await readGitHead(canonicalPath) };
        } catch {
          return null;
        }
      }),
    );
    const parent = path.dirname(expanded);
    return {
      ok: true,
      path: canonical,
      displayPath: typed.startsWith("~") ? typed : expanded,
      home,
      parent: parent === expanded ? null : parent,
      git: await readGitHead(canonical),
      folders: folders.filter((entry): entry is FolderEntry => entry !== null),
      truncated: children.length > 500,
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      ok: false,
      path: typed,
      error:
        code === "EACCES" || code === "EPERM"
          ? "permission-denied"
          : code === "ENOTDIR"
            ? "not-directory"
            : "not-found",
    };
  }
}
