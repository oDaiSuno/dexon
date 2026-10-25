import { useMemo } from "react";
import { useI18n } from "@/i18n";
import { ActionMenu } from "./action-menu";
import { getFileIcon } from "./FileIcons";
import { EllipsisGlyph, XGlyph } from "./processes/process-icons";
import type { FileTab } from "@/lib/file-tab-state";

interface Props {
  tabs: FileTab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
}

const MOTION = "duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)] motion-reduce:transition-none";

export function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab }: Props) {
  const { t } = useI18n();
  const closeLabel = t("closeFileTab", "Close {name}");
  const allTabsLabel = t("allFileTabs", "All tabs");
  const menuItems = useMemo(
    () =>
      tabs.map((tab) => ({
        key: tab.id,
        label: tab.label,
        title: tab.filePath,
        checked: tab.id === activeTabId,
        onSelect: () => onSelectTab(tab.id),
      })),
    [tabs, activeTabId, onSelectTab],
  );

  return (
    <div className="flex min-w-0 flex-1 items-center gap-[2px] px-[8px]">
      <div className="flex min-w-0 flex-1 items-center gap-[2px] overflow-x-auto [scrollbar-width:none]">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const closeName = closeLabel.replace("{name}", tab.label);

          return (
            <div
              key={tab.id}
              className={`group flex h-[28px] max-w-[168px] shrink-0 items-center rounded-[var(--radius-chip)] py-0 pr-[4px] transition-[background-color,box-shadow] ${MOTION} ${
                isActive
                  ? "bg-[var(--fx-surface-raised)] shadow-[var(--shadow-tab)]"
                  : "bg-[var(--fx-surface-hover-clear)] hover:bg-[var(--fx-surface-hover-overlay)]"
              }`}
            >
              <button
                type="button"
                aria-current={isActive ? "page" : undefined}
                title={tab.filePath}
                onClick={() => onSelectTab(tab.id)}
                className={`flex h-full min-w-0 flex-1 cursor-pointer items-center gap-[6px] border-none bg-transparent py-0 pr-[6px] pl-[8px] text-left transition-colors ${MOTION} ${
                  isActive
                    ? "text-[var(--fx-text-primary)]"
                    : "text-[var(--fx-text-secondary)] group-hover:text-[var(--fx-text-primary)]"
                }`}
              >
                <span
                  className={`flex shrink-0 items-center ${isActive ? "[&_svg]:[stroke:var(--fx-text-primary)]" : ""}`}
                >
                  {getFileIcon(tab.label, 13)}
                </span>
                <span className={`min-w-0 truncate ${isActive ? "type-label-medium" : "type-label-default"}`}>
                  {tab.label}
                </span>
              </button>
              <button
                type="button"
                aria-label={closeName}
                title={closeName}
                onClick={() => onCloseTab(tab.id)}
                className={`flex size-[16px] shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-xs)] border-none bg-[var(--fx-surface-hover-clear)] p-0 text-[var(--fx-text-secondary)] transition-[background-color,opacity] hover:bg-[var(--fx-surface-hover-overlay-strong)] group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 ${MOTION} ${
                  isActive ? "opacity-100" : "opacity-0"
                }`}
              >
                <XGlyph size={11} strokeWidth={2} />
              </button>
            </div>
          );
        })}
      </div>
      <ActionMenu
        label={allTabsLabel}
        items={menuItems}
        trigger={(props) => (
          <button
            type="button"
            className="file-viewer-icon-button"
            aria-label={allTabsLabel}
            title={allTabsLabel}
            {...props}
          >
            <EllipsisGlyph />
          </button>
        )}
      />
    </div>
  );
}
