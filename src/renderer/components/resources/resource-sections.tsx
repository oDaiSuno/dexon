import type { ReactNode } from "react";
import { useI18n } from "@/i18n";
import { formatNumber } from "@/lib/locale-format";
import type { PackageResource } from "./overview-model";
import { ArrowRightIcon, ChevronRightIcon, PackageIcon, PuzzleIcon } from "./overview-icons";

const ROW_HOVER =
  "bg-[var(--fx-surface-hover-clear)] transition-colors duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)] hover:bg-[var(--fx-surface-hover-overlay)] motion-reduce:transition-none";

export function SectionHeader({
  id,
  title,
  count,
  children,
}: {
  id: string;
  title: string;
  count: number;
  children?: ReactNode;
}) {
  const { language } = useI18n();
  return (
    <div className="flex h-[32px] w-full items-center gap-[8px]">
      <h2 id={id} className="type-title-dialog m-0 text-[var(--fx-text-primary)]">
        {title}
      </h2>
      <span className="type-body-default min-w-0 flex-1 text-[var(--fx-text-tertiary)]">
        {formatNumber(count, language)}
      </span>
      {children}
    </div>
  );
}

function ResourceCard({ children }: { children: ReactNode }) {
  return (
    <ul className="m-0 flex w-full list-none flex-col overflow-hidden rounded-[var(--radius-resource-card)] border border-solid border-[var(--fx-line-default)] bg-[var(--fx-surface-raised)] p-0">
      {children}
    </ul>
  );
}

const rowDivider = (index: number) => (index > 0 ? " border-t border-solid border-[var(--fx-line-default)]" : "");

export function ExtensionsSection({
  extensions,
  onOpen,
}: {
  extensions: PackageResource[];
  onOpen: (resource: PackageResource) => void;
}) {
  const { t } = useI18n();
  if (extensions.length === 0) return null;
  return (
    <section aria-labelledby="resource-extensions-heading" className="flex w-full flex-col gap-[12px]">
      <SectionHeader
        id="resource-extensions-heading"
        title={t("resourcesToolExtensions", "Tool extensions")}
        count={extensions.length}
      />
      <ResourceCard>
        {extensions.map((extension, index) => (
          <li key={extension.key} className={`flex${rowDivider(index)}`}>
            <button
              type="button"
              onClick={() => onOpen(extension)}
              className={`flex w-full min-w-0 cursor-pointer items-center gap-[14px] border-0 px-[16px] py-[14px] text-left ${ROW_HOVER}`}
            >
              <span className="flex size-[32px] shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-solid border-[var(--fx-line-default)] bg-[var(--fx-surface-card)] text-[var(--fx-text-secondary)]">
                <PuzzleIcon size={16} />
              </span>
              <span className="type-body-large-medium min-w-0 flex-1 truncate text-[var(--fx-text-primary)]">
                {extension.name}
              </span>
              <span className="type-label-default shrink-0 text-[var(--fx-text-tertiary)]">
                {t("resourcesFromPackage", "From {name}").replace("{name}", extension.origin)}
              </span>
              <ChevronRightIcon size={15} className="text-[var(--fx-text-tertiary)]" />
            </button>
          </li>
        ))}
      </ResourceCard>
    </section>
  );
}

export function PromptsSection({
  prompts,
  onOpen,
}: {
  prompts: PackageResource[];
  onOpen: (resource: PackageResource) => void;
}) {
  const { t } = useI18n();
  if (prompts.length === 0) return null;
  return (
    <section aria-labelledby="resource-prompts-heading" className="flex w-full flex-col gap-[12px]">
      <SectionHeader
        id="resource-prompts-heading"
        title={t("resourcesPromptTemplates", "Prompt templates")}
        count={prompts.length}
      />
      <ResourceCard>
        {prompts.map((prompt, index) => (
          <li key={prompt.key} className={`flex${rowDivider(index)}`}>
            <button
              type="button"
              onClick={() => onOpen(prompt)}
              className={`flex w-full min-w-0 cursor-pointer items-center gap-[10px] border-0 px-[16px] py-[12px] text-left ${ROW_HOVER}`}
            >
              <span className="type-mono-label flex h-[22px] shrink-0 items-center rounded-[var(--radius-chip)] bg-[var(--fx-surface-card)] px-[7px] text-[var(--fx-text-primary)]">
                /{prompt.name}
              </span>
            </button>
          </li>
        ))}
      </ResourceCard>
    </section>
  );
}

export function SourcesBar({ packageCount, onOpen }: { packageCount: number; onOpen: () => void }) {
  const { language, t } = useI18n();
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t("resourcesManageSources", "Manage sources")}
      aria-describedby="resource-sources-summary"
      className={`flex w-full cursor-pointer items-center gap-[12px] rounded-[var(--radius-resource-tile)] border border-solid border-[var(--fx-line-default)] px-[16px] py-[14px] text-left ${ROW_HOVER}`}
    >
      <PackageIcon size={16} className="text-[var(--fx-text-secondary)]" />
      <span id="resource-sources-summary" className="type-body-default min-w-0 flex-1 text-[var(--fx-text-secondary)]">
        {t("resourcesSourcesSummary", "These capabilities come from {count} installed packages").replace(
          "{count}",
          formatNumber(packageCount, language),
        )}
      </span>
      <span className="type-body-medium shrink-0 text-[var(--fx-text-primary)]">
        {t("resourcesManageSources", "Manage sources")}
      </span>
      <ArrowRightIcon size={15} className="text-[var(--fx-text-primary)]" />
    </button>
  );
}
