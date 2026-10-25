import { useCallback, useEffect, useState } from "react";
import { getFileName, getParentFilePath, joinFilePath } from "@/lib/file-paths";
import { formatNumber } from "@/lib/locale-format";
import { worktreePathsEqual } from "@shared/worktree-path";
import { useI18n } from "@/i18n";
import { FolderIcon, getFileIcon } from "../FileIcons";
import { Icon } from "../chat-input/icons";
import {
  CHANGE_LETTER_CLASS,
  CHANGE_SWATCH_COLOR,
  fileChangeLabel,
  type ChangeGroup,
  type ChangeRow,
  type FileChange,
} from "./git-marks";

const CHANGES_ONLY_STORAGE_KEY = "dexon:explorer-changes-only";

function readChangesOnly(): boolean {
  try {
    return window.localStorage.getItem(CHANGES_ONLY_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeChangesOnly(on: boolean) {
  try {
    if (on) window.localStorage.setItem(CHANGES_ONLY_STORAGE_KEY, "1");
    else window.localStorage.removeItem(CHANGES_ONLY_STORAGE_KEY);
  } catch {}
}

export function useChangesOnlyPreference(): [boolean, () => void] {
  const [on, setOn] = useState(readChangesOnly);
  useEffect(() => writeChangesOnly(on), [on]);
  const toggle = useCallback(() => setOn((value) => !value), []);
  return [on, toggle];
}

function ChangeRowItem({
  cwd,
  change,
  row,
  activeFilePath,
  onOpenFile,
}: {
  cwd: string;
  change: FileChange;
  row: ChangeRow;
  activeFilePath: string | null;
  onOpenFile: (filePath: string, fileName: string) => void;
}) {
  const { t } = useI18n();
  const fullPath = joinFilePath(cwd, row.path);
  const name = getFileName(row.path);
  const dir = getParentFilePath(row.path);
  const current = activeFilePath !== null && worktreePathsEqual(fullPath, activeFilePath);
  const nameClass = `${current ? "type-body-medium" : "type-body-default"} truncate ${
    change === "conflicted" ? "text-[var(--fx-status-danger-text)]" : "text-[var(--fx-text-primary)]"
  }`;
  const body = (
    <>
      <span className={current ? "flex shrink-0 [&_svg]:[stroke:var(--fx-text-primary)]" : "flex shrink-0"}>
        {row.isFolder ? <FolderIcon size={14} /> : getFileIcon(name, 14)}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-[6px] overflow-hidden">
        <span className={nameClass}>{name}</span>
        {dir !== "" && (
          <span className="type-mono-meta min-w-0 flex-1 truncate text-[var(--fx-text-tertiary)]">{dir}</span>
        )}
      </span>
      <span className={`type-mono-meta shrink-0 ${CHANGE_LETTER_CLASS[change]}`}>{row.letter}</span>
    </>
  );
  const layout =
    "flex h-[28px] w-full items-center gap-[8px] rounded-[var(--radius-chip)] border-0 pr-[8px] pl-[28px] text-left select-none";

  if (row.isFolder) {
    return (
      <div className={layout} title={fullPath}>
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpenFile(fullPath, name)}
      aria-current={current ? "true" : undefined}
      aria-label={t("openFile", "Open file {name}").replace("{name}", name)}
      title={fullPath}
      className={`${layout} cursor-pointer ${
        current ? "bg-[var(--fx-surface-selected)]" : "bg-transparent hover:bg-[var(--fx-surface-hover-overlay)]"
      }`}
      style={{ transition: "background 0.12s" }}
    >
      {body}
    </button>
  );
}

export function ChangesList({
  cwd,
  groups,
  activeFilePath,
  onOpenFile,
}: {
  cwd: string;
  groups: ChangeGroup[];
  activeFilePath: string | null;
  onOpenFile: (filePath: string, fileName: string) => void;
}) {
  const { language, t } = useI18n();
  const [folded, setFolded] = useState<Set<FileChange>>(() => new Set());
  const toggleGroup = useCallback((change: FileChange) => {
    setFolded((previous) => {
      const next = new Set(previous);
      if (next.has(change)) next.delete(change);
      else next.add(change);
      return next;
    });
  }, []);

  if (groups.length === 0) {
    return (
      <div className="type-meta-default px-[12px] py-[8px] text-[var(--fx-text-tertiary)]">
        {t("explorerNoChanges", "No changes")}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[12px]">
      {groups.map((group) => {
        const label = fileChangeLabel(t, group.change);
        const count = formatNumber(group.rows.length, language);
        const open = !folded.has(group.change);
        return (
          <div key={group.change} className="flex flex-col gap-[1px]">
            <button
              type="button"
              aria-expanded={open}
              aria-label={`${label} ${count}`}
              onClick={() => toggleGroup(group.change)}
              className="flex h-[26px] w-full cursor-pointer items-center gap-[8px] rounded-[var(--radius-chip)] border-0 bg-transparent px-[8px] text-left hover:bg-[var(--fx-surface-hover-overlay)]"
            >
              <span aria-hidden className="flex shrink-0 text-[var(--fx-text-tertiary)]">
                <Icon size={12}>{open ? <path d="m6 9 6 6 6-6" /> : <path d="m9 18 6-6-6-6" />}</Icon>
              </span>
              <span
                className="size-[6px] shrink-0 rounded-[var(--radius-bar)]"
                style={{ background: CHANGE_SWATCH_COLOR[group.change] }}
              />
              <span className="type-label-medium shrink-0 text-[var(--fx-text-secondary)]">{label}</span>
              <span className="type-mono-meta min-w-0 flex-1 truncate text-[var(--fx-text-tertiary)]">{count}</span>
            </button>
            {open && (
              <div role="group" aria-label={label} className="flex flex-col gap-[1px]">
                {group.rows.map((row) => (
                  <ChangeRowItem
                    key={`${group.change}:${row.path}`}
                    cwd={cwd}
                    change={group.change}
                    row={row}
                    activeFilePath={activeFilePath}
                    onOpenFile={onOpenFile}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
