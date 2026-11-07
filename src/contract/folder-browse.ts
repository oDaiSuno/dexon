export interface GitHeadSummary {
  branch: string | null;
  detached: boolean;
}
export interface FolderEntry {
  name: string;
  path: string;
  displayPath: string;
  git: GitHeadSummary | null;
}
export type FolderBrowseErrorCode = "not-absolute" | "not-found" | "not-directory" | "permission-denied";
export type FolderListing =
  | {
      ok: true;
      path: string;
      displayPath: string;
      home: string;
      parent: string | null;
      git: GitHeadSummary | null;
      folders: FolderEntry[];
      truncated: boolean;
    }
  | { ok: false; path: string; error: FolderBrowseErrorCode };
