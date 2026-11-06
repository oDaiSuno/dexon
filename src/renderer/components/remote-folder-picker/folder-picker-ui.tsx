import { useI18n } from "@/i18n";
import type { GitHeadSummary } from "@contract/folder-browse";
import type { FolderBrowserError } from "./folder-browser-state";

export function FolderPickerIcon({ kind, size = 16 }: { kind: "server" | "folder" | "home"; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      {kind === "server" && (
        <>
          <rect x="3" y="3" width="18" height="7" rx="2" />
          <rect x="3" y="14" width="18" height="7" rx="2" />
          <path d="M7 6.5h.01M7 17.5h.01" />
        </>
      )}
      {kind === "folder" && <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />}
      {kind === "home" && (
        <>
          <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z" />
          <path d="M9 21v-9h6v9" />
        </>
      )}
    </svg>
  );
}

export function GitBranchBadge({ git }: { git: GitHeadSummary | null }) {
  const { t } = useI18n();
  if (!git) return null;
  return (
    <span
      className="type-mono-meta remote-folder-branch"
      title={git.detached ? t("remoteFolderDetached", "detached HEAD") : (git.branch ?? undefined)}
      style={{
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        color: "var(--fx-accent-blue-text)",
        whiteSpace: "nowrap",
      }}
    >
      {t("remoteFolderGit", "git")} · {git.detached ? t("remoteFolderDetached", "detached HEAD") : git.branch}
    </span>
  );
}

export function useFolderErrorLabel(error: FolderBrowserError | null): string | null {
  const { t } = useI18n();
  if (!error) return null;
  if (error.kind === "request")
    return t("remoteFolderRequestFailed", "Could not read this folder. Check the server connection and try again.");
  switch (error.code) {
    case "not-absolute":
      return t("remoteFolderPathAbsolute", "Enter an absolute path or a path beginning with ~.");
    case "not-found":
      return t("remoteFolderPathNotFound", "This folder does not exist on the server.");
    case "not-directory":
      return t("remoteFolderPathNotDirectory", "This path is not a folder.");
    case "permission-denied":
      return t("remoteFolderPathPermission", "You do not have permission to read this folder.");
  }
}
