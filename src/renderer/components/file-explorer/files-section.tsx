import { useI18n } from "@/i18n";
import { Icon } from "../chat-input/icons";

const SKELETON_ROWS: [number, number][] = [
  [22, 120],
  [22, 84],
  [38, 150],
  [38, 110],
  [54, 136],
  [54, 96],
  [38, 128],
  [22, 72],
  [22, 104],
  [22, 88],
];

export function FilesSectionHeader({ onCollapseAll }: { onCollapseAll: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex h-[28px] items-center gap-[2px] pr-[2px] pl-[8px]">
      <h2 className="type-label-medium m-0 min-w-0 flex-1 truncate text-[var(--fx-text-secondary)]">
        {t("explorerFilesSection", "Files")}
      </h2>
      <button
        type="button"
        onClick={onCollapseAll}
        aria-label={t("explorerCollapseAll", "Collapse all")}
        title={t("explorerCollapseAll", "Collapse all")}
        className="flex size-[24px] shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-chip)] border-0 bg-transparent p-0 text-[var(--fx-text-tertiary)] hover:bg-[var(--fx-surface-hover-overlay)]"
      >
        <Icon size={14}>
          <path d="m7 20 5-5 5 5" />
          <path d="m7 4 5 5 5-5" />
        </Icon>
      </button>
    </div>
  );
}

export function FileTreeSkeleton() {
  const { t } = useI18n();
  return (
    <>
      <span className="sr-only" role="status">
        {t("loadingFiles", "Loading files…")}
      </span>
      <div aria-hidden className="flex flex-col gap-[1px] motion-safe:animate-pulse">
        {SKELETON_ROWS.map(([indent, width], index) => (
          <div key={index} className="flex h-[28px] items-center gap-[8px] pr-[8px]" style={{ paddingLeft: indent }}>
            <span className="size-[14px] shrink-0 rounded-[var(--radius-xs)] bg-[var(--fx-surface-subtle)]" />
            <span
              className="h-[9px] shrink-0 rounded-[var(--radius-skeleton)] bg-[var(--fx-surface-subtle)]"
              style={{ width }}
            />
          </div>
        ))}
      </div>
    </>
  );
}
