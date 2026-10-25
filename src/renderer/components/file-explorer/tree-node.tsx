import { useCallback, useEffect, useEffectEvent, useId, useState } from "react";
import { getFileIcon, FolderIcon } from "../FileIcons";
import { Icon } from "../chat-input/icons";
import { encodeFilePathForApi, getRelativeFilePath, joinFilePath } from "@/lib/file-paths";
import { directoryRefreshAction, shouldLoadDirectoryOnExpand } from "@/lib/directory-refresh";
import { worktreePathsEqual } from "@shared/worktree-path";
import { useI18n } from "@/i18n";
import type { FolderChange, GitTreeMarks, Translate } from "./git-marks";
import { CHANGE_LETTER_CLASS, fileChangeLabel } from "./git-marks";

interface FileEntry {
  name: string;
  isDir: boolean;
  size: number;
  modified: string;
}

export interface FileNode {
  name: string;
  fullPath: string;
  isDir: boolean;
  size: number;
  children?: FileNode[];
  loaded?: boolean;
}

export interface TreeShared {
  cwd: string;
  activeFilePath: string | null;
  onOpenFile: (filePath: string, fileName: string) => void;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  expandedPaths: Set<string>;
  onToggleExpanded: (fullPath: string, open: boolean) => void;
  refreshKey: number;
  marks: GitTreeMarks;
}

const FOLDER_DOT_CLASS: Record<FolderChange, string> = {
  changed: "bg-[var(--fx-status-warning)]",
  untracked: "bg-[var(--fx-text-tertiary)]",
  conflicted: "bg-[var(--fx-status-danger)]",
};

function folderChangeLabel(t: Translate, change: FolderChange): string {
  if (change === "changed") return t("explorerFolderChanged", "Contains changes");
  if (change === "untracked") return t("explorerFolderUntracked", "Contains untracked files");
  return t("explorerFolderConflicted", "Contains conflicts");
}

export async function fetchEntries(dirPath: string, t: Translate): Promise<FileNode[]> {
  const encoded = encodeFilePathForApi(dirPath);
  const res = await fetch(`/api/files/${encoded}?type=list`);
  if (!res.ok) {
    let message = t("fileListLoadFailedStatus", "Failed to load files (HTTP {status})").replace(
      "{status}",
      String(res.status),
    );
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    if (data?.error) message = data.error;
    throw new Error(message);
  }
  const data = (await res.json()) as { entries?: FileEntry[] };
  return (data.entries ?? []).map((e) => ({
    name: e.name,
    fullPath: joinFilePath(dirPath, e.name),
    isDir: e.isDir,
    size: e.size,
    children: e.isDir ? [] : undefined,
    loaded: !e.isDir,
  }));
}

function ChevronGlyph({ open }: { open: boolean }) {
  const path = open ? <path d="m6 9 6 6 6-6" /> : <path d="m9 18 6-6-6-6" />;
  return <Icon size={12}>{path}</Icon>;
}

function AtSignGlyph() {
  return (
    <Icon size={11}>
      <circle cx="12" cy="12" r="4" />
      <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
    </Icon>
  );
}

function DownloadGlyph() {
  return (
    <Icon size={11}>
      <path d="M12 15V3" />
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5" />
    </Icon>
  );
}

function TreeGuides({ depth }: { depth: number }) {
  return (
    <>
      {Array.from({ length: depth }, (_, index) => (
        <span key={index} aria-hidden className="flex h-[28px] w-[16px] shrink-0 justify-center">
          <span className="h-[28px] w-[1px] bg-[var(--fx-line-default)]" />
        </span>
      ))}
    </>
  );
}

export function TreeNode({ node, depth, tree }: { node: FileNode; depth: number; tree: TreeShared }) {
  const { t } = useI18n();
  const open = tree.expandedPaths.has(node.fullPath);
  const current = !node.isDir && tree.activeFilePath !== null && worktreePathsEqual(node.fullPath, tree.activeFilePath);
  const [children, setChildren] = useState<FileNode[]>(node.children ?? []);
  const [loaded, setLoaded] = useState(node.loaded ?? false);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focusedWithin, setFocusedWithin] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const descriptionId = useId();

  const loadChildren = useCallback(
    async (force = false) => {
      if (loaded && !stale && !force) return;
      setLoading(true);
      try {
        const entries = await fetchEntries(node.fullPath, t);
        setChildren(entries);
        setLoaded(true);
        setStale(false);
      } catch {
      } finally {
        setLoading(false);
      }
    },
    [loaded, node.fullPath, stale, t],
  );

  const refreshFromKey = useEffectEvent(() => {
    if (!node.isDir) return;
    const refreshAction = directoryRefreshAction(open, loaded);
    if (refreshAction === "reload") void loadChildren(true);
    else if (refreshAction === "mark-stale") {
      setLoaded(false);
      setStale(true);
    }
  });

  useEffect(() => {
    refreshFromKey();
  }, [tree.refreshKey]);

  const handleClick = useCallback(() => {
    if (node.isDir) {
      const next = !open;
      tree.onToggleExpanded(node.fullPath, next);
      if (next && shouldLoadDirectoryOnExpand(loaded, stale)) void loadChildren();
    } else {
      tree.onOpenFile(node.fullPath, node.name);
    }
  }, [node.isDir, node.fullPath, node.name, loaded, stale, open, loadChildren, tree]);

  const relativePath = getRelativeFilePath(node.fullPath, tree.cwd);
  const fileMark = node.isDir ? null : tree.marks.file(relativePath);
  const folderChange = node.isDir ? tree.marks.folder(relativePath) : null;
  const described = node.isDir
    ? folderChange && folderChangeLabel(t, folderChange)
    : fileMark && fileChangeLabel(t, fileMark.change);
  const actionsShown = (hovered || focusedWithin) && (!node.isDir || Boolean(tree.onAtMention));
  const showStatus = Boolean(described) && !actionsShown;

  const background = current
    ? "bg-[var(--fx-surface-selected)]"
    : hovered || focusedWithin
      ? "bg-[var(--fx-surface-hover-overlay)]"
      : "bg-transparent";
  const nameColor =
    fileMark?.change === "conflicted" ? "text-[var(--fx-status-danger-text)]" : "text-[var(--fx-text-primary)]";

  return (
    <div className="flex flex-col gap-[1px]">
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocusedWithin(true)}
        onBlur={(event) => {
          const next = event.relatedTarget as Node | null;
          if (!next || !event.currentTarget.contains(next)) setFocusedWithin(false);
        }}
        className={`flex h-[28px] items-center rounded-[var(--radius-chip)] pr-[6px] pl-[4px] ${background}`}
        style={{ transition: "background 0.12s" }}
      >
        <button
          type="button"
          onClick={handleClick}
          aria-current={current ? "true" : undefined}
          aria-expanded={node.isDir ? open : undefined}
          aria-label={
            node.isDir
              ? open
                ? t("collapseFolder", "Collapse folder {name}").replace("{name}", node.name)
                : t("expandFolder", "Expand folder {name}").replace("{name}", node.name)
              : t("openFile", "Open file {name}").replace("{name}", node.name)
          }
          aria-describedby={described ? descriptionId : undefined}
          title={node.fullPath}
          className="flex h-[28px] min-w-0 flex-1 cursor-pointer items-center border-0 bg-transparent p-0 text-left select-none"
        >
          <TreeGuides depth={depth} />
          <span
            aria-hidden
            className="flex h-[28px] w-[16px] shrink-0 items-center justify-center text-[var(--fx-text-tertiary)]"
          >
            {node.isDir && <ChevronGlyph open={open} />}
          </span>
          <span className="flex h-[28px] min-w-0 flex-1 items-center gap-[8px] pl-[2px]">
            <span className={current ? "flex shrink-0 [&_svg]:[stroke:var(--fx-text-primary)]" : "flex shrink-0"}>
              {node.isDir ? <FolderIcon size={14} open={open} /> : getFileIcon(node.name, 14)}
            </span>
            <span
              className={`${current ? "type-body-medium" : "type-body-default"} min-w-0 flex-1 truncate ${nameColor}`}
            >
              {node.name}
            </span>
            {loading && (
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--fx-text-tertiary)"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4" />
              </svg>
            )}
            {showStatus && (
              <span aria-hidden className="flex h-[28px] w-[14px] shrink-0 items-center justify-center">
                {folderChange ? (
                  <span className={`size-[6px] rounded-[var(--radius-pill)] ${FOLDER_DOT_CLASS[folderChange]}`} />
                ) : fileMark ? (
                  <span className={`type-mono-meta ${CHANGE_LETTER_CLASS[fileMark.change]}`}>{fileMark.letter}</span>
                ) : null}
              </span>
            )}
          </span>
          {described && (
            <span id={descriptionId} className="sr-only">
              {described}
            </span>
          )}
        </button>
        {actionsShown && (
          <div className="flex h-[20px] shrink-0 items-center gap-[4px]">
            {tree.onAtMention && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  tree.onAtMention?.(getRelativeFilePath(node.fullPath, tree.cwd), node.isDir);
                }}
                title={t("insertPathIntoChat", "Insert path into chat")}
                className="type-meta-default flex h-[20px] shrink-0 cursor-pointer items-center gap-[4px] whitespace-nowrap rounded-[var(--radius-xs)] border border-solid border-[var(--fx-line-default)] bg-[var(--fx-surface-raised)] pr-[6px] pl-[5px] text-[var(--fx-accent-blue-text)]"
              >
                <AtSignGlyph />
                {t("mention", "mention")}
              </button>
            )}
            {!node.isDir && (
              <button
                type="button"
                disabled={downloading}
                aria-label={t("downloadFile", "Download file")}
                onClick={(e) => {
                  e.stopPropagation();
                  setDownloading(true);
                  void import("@/lib/file-blob")
                    .then(({ downloadFileViaRpc }) => downloadFileViaRpc(node.fullPath, node.name))
                    .catch((error) => console.error("download failed", error))
                    .finally(() => setDownloading(false));
                }}
                title={t("downloadFile", "Download file")}
                className={`flex size-[20px] shrink-0 items-center justify-center rounded-[var(--radius-xs)] border border-solid border-[var(--fx-line-default)] bg-[var(--fx-surface-raised)] p-0 text-[var(--fx-text-secondary)] ${downloading ? "cursor-wait" : "cursor-pointer"}`}
              >
                <DownloadGlyph />
              </button>
            )}
          </div>
        )}
      </div>
      {node.isDir && open && (
        <div className="flex flex-col gap-[1px]">
          {children.map((child) => (
            <TreeNode key={child.fullPath} node={child} depth={depth + 1} tree={tree} />
          ))}
          {children.length === 0 && loaded && (
            <div className="flex h-[28px] items-center pr-[6px] pl-[4px]">
              <TreeGuides depth={depth + 1} />
              <span aria-hidden className="w-[16px] shrink-0" />
              <span className="type-meta-default pl-[2px] text-[var(--fx-text-tertiary)]">{t("empty", "empty")}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
