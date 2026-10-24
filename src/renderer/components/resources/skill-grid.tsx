import { useState } from "react";
import type { PluginPackageInfo } from "@/lib/api-types";
import { useI18n } from "@/i18n";
import type { Skill } from "../skills/skill-shared";
import { SkillToggle } from "../skills/skill-toggle";
import { matchesSkillQuery, skillOriginText } from "./overview-model";
import { SectionHeader } from "./resource-sections";
import { SkillIcon, SparklesIcon } from "./overview-icons";

const TILE_HOVER =
  "transition-colors duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)] motion-reduce:transition-none";

function SkillCard({
  skill,
  packages,
  toggling,
  onOpen,
  onToggle,
}: {
  skill: Skill;
  packages: PluginPackageInfo[];
  toggling: boolean;
  onOpen: () => void;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const visible = !skill.disableModelInvocation;
  return (
    <li
      className={`relative flex min-w-0 flex-col gap-[10px] rounded-[var(--radius-resource-tile)] border border-solid border-[var(--fx-line-default)] bg-[var(--fx-surface-raised)] p-[16px] hover:bg-[var(--fx-surface-raised-hover)] ${TILE_HOVER}`}
    >
      <div className="flex w-full items-center gap-[10px]">
        <span className="flex size-[32px] shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-solid border-[var(--fx-line-default)] bg-[var(--fx-surface-card)] text-[var(--fx-text-secondary)]">
          <SkillIcon size={16} />
        </span>
        <button
          type="button"
          onClick={onOpen}
          className="type-body-large-medium min-w-0 flex-1 cursor-pointer truncate border-0 bg-transparent p-0 text-left text-[var(--fx-text-primary)] after:absolute after:inset-0 after:rounded-[var(--radius-resource-tile)] after:content-['']"
        >
          {skill.name}
        </button>
        <SkillToggle className="relative z-[1]" enabled={visible} loading={toggling} onToggle={onToggle} />
      </div>
      {skill.description && (
        <p className="type-body-relaxed m-0 text-pretty text-[var(--fx-text-secondary)]">{skill.description}</p>
      )}
      <p className="type-label-default m-0 text-[var(--fx-text-tertiary)]">{skillOriginText(skill, packages, t)}</p>
    </li>
  );
}

export function SkillGrid({
  skills,
  packages,
  loading,
  error,
  toggling,
  saveError,
  onOpenSkill,
  onToggle,
  onDiscover,
}: {
  skills: Skill[];
  packages: PluginPackageInfo[];
  loading: boolean;
  error: string | null;
  toggling: Set<string>;
  saveError: string | null;
  onOpenSkill: (skill: Skill) => void;
  onToggle: (skill: Skill) => void;
  onDiscover: () => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const shown = skills.filter((skill) => matchesSkillQuery(skill, query));
  const status = loading ? t("loading", "Loading…") : error;

  return (
    <section aria-labelledby="resource-skills-heading" className="flex w-full flex-col gap-[12px]">
      <SectionHeader id="resource-skills-heading" title={t("skills", "Skills")} count={skills.length}>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("skillPickerSearch", "Search skills…")}
          aria-label={t("skillPickerSearch", "Search skills…")}
          className="ui-input type-body-default shrink-0"
          style={{ width: 200 }}
        />
      </SectionHeader>
      {status && (
        <p
          role={error && !loading ? "alert" : "status"}
          className={`type-body-default m-0 ${error && !loading ? "text-[var(--fx-status-danger)]" : "text-[var(--fx-text-tertiary)]"}`}
        >
          {status}
        </p>
      )}
      {saveError && (
        <p role="alert" className="type-label-default m-0 text-[var(--fx-status-danger)]">
          {saveError}
        </p>
      )}
      <ul className="m-0 grid w-full list-none grid-cols-2 gap-[12px] p-0">
        {!loading &&
          shown.map((skill) => (
            <SkillCard
              key={skill.filePath}
              skill={skill}
              packages={packages}
              toggling={toggling.has(skill.filePath)}
              onOpen={() => onOpenSkill(skill)}
              onToggle={() => onToggle(skill)}
            />
          ))}
        <li className="flex min-w-0">
          <button
            type="button"
            onClick={onDiscover}
            className={`flex h-full w-full min-w-0 cursor-pointer flex-col items-center justify-center gap-[8px] rounded-[var(--radius-resource-tile)] border border-dashed border-[var(--fx-line-strong)] bg-[var(--fx-surface-hover-clear)] p-[16px] hover:bg-[var(--fx-surface-hover-overlay)] ${TILE_HOVER}`}
          >
            <SparklesIcon size={18} className="text-[var(--fx-text-secondary)]" />
            <span className="type-body-medium text-[var(--fx-text-primary)]">
              {t("resourcesDiscoverSkills", "Discover more skills")}
            </span>
            <span className="type-label-default text-[var(--fx-text-tertiary)]">
              {t("resourcesDiscoverSkillsHint", "Search skills.sh and install in one click")}
            </span>
          </button>
        </li>
      </ul>
    </section>
  );
}
