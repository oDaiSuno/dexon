import type { ComponentType } from "react";
import { useI18n, type AppLanguage } from "@/i18n";
import { formatNumber } from "@/lib/locale-format";
import appIconUrl from "../../../../build/icon.png";
import type { CapabilitySummary } from "./overview-model";
import { EyeOffIcon, PuzzleIcon, SkillIcon, SlashIcon } from "./overview-icons";

type Translate = (key: string, fallback: string) => string;
type OrbitIcon = ComponentType<{ size: number; className?: string }>;

interface OrbitKind {
  key: "skills" | "extensions" | "prompts";
  color: string;
  border: string;
  icon: OrbitIcon;
  slots: { top: number; left: number; size: 26 | 30 }[];
}

const ORBIT_KINDS: OrbitKind[] = [
  {
    key: "skills",
    color: "var(--fx-data-blue)",
    border: "var(--fx-accent-blue-border)",
    icon: SkillIcon,
    slots: [
      { top: 17, left: 155, size: 30 },
      { top: 52, left: 227, size: 30 },
      { top: 129, left: 245, size: 30 },
      { top: 192, left: 195, size: 30 },
      { top: 192, left: 115, size: 30 },
    ],
  },
  {
    key: "extensions",
    color: "var(--fx-data-violet)",
    border: "var(--fx-line-translucent)",
    icon: PuzzleIcon,
    slots: [
      { top: 73, left: 195, size: 26 },
      { top: 149, left: 195, size: 26 },
      { top: 149, left: 119, size: 26 },
    ],
  },
  {
    key: "prompts",
    color: "var(--fx-data-green)",
    border: "var(--fx-line-translucent)",
    icon: SlashIcon,
    slots: [
      { top: 129, left: 65, size: 30 },
      { top: 52, left: 83, size: 30 },
      { top: 73, left: 119, size: 26 },
    ],
  },
];

function legend(summary: CapabilitySummary, t: Translate) {
  return [
    {
      key: "skills",
      color: "var(--fx-data-blue)",
      label: t("resourcesLegendSkills", "Skills"),
      count: summary.readySkills,
    },
    {
      key: "extensions",
      color: "var(--fx-data-violet)",
      label: t("resourcesLegendExtensions", "Tool extensions"),
      count: summary.extensions,
    },
    {
      key: "prompts",
      color: "var(--fx-data-green)",
      label: t("resourcesLegendPrompts", "Prompts"),
      count: summary.prompts,
    },
  ];
}

function footnote(summary: CapabilitySummary, language: AppLanguage, t: Translate) {
  const count = (value: number) => formatNumber(value, language);
  if (summary.hidden && summary.unavailable) {
    return t("resourcesFootnoteBoth", "{hidden} more hidden from the model, {unavailable} unavailable")
      .replace("{hidden}", count(summary.hidden))
      .replace("{unavailable}", count(summary.unavailable));
  }
  if (summary.hidden) {
    return t("resourcesFootnoteHidden", "{hidden} more hidden from the model").replace(
      "{hidden}",
      count(summary.hidden),
    );
  }
  if (summary.unavailable) {
    return t("resourcesFootnoteUnavailable", "{unavailable} more unavailable").replace(
      "{unavailable}",
      count(summary.unavailable),
    );
  }
  return null;
}

function orbitCount(summary: CapabilitySummary, key: OrbitKind["key"]): number {
  if (key === "skills") return summary.readySkills;
  if (key === "extensions") return summary.extensions;
  return summary.prompts;
}

function OrbitTiles({ summary }: { summary: CapabilitySummary }) {
  return ORBIT_KINDS.flatMap((kind) =>
    kind.slots.slice(0, orbitCount(summary, kind.key)).map((slot, index) => {
      const Icon = kind.icon;
      return (
        <span
          key={`${kind.key}-${index}`}
          data-orbit-kind={kind.key}
          className="absolute flex items-center justify-center rounded-[var(--radius-icon-box)] border border-solid bg-[var(--fx-surface-card)]"
          style={{
            top: slot.top,
            left: slot.left,
            width: slot.size,
            height: slot.size,
            borderColor: kind.border,
            color: kind.color,
            boxShadow: `0 0 14px 0 color-mix(in srgb, ${kind.color} 15%, transparent)`,
          }}
        >
          <Icon size={slot.size === 30 ? 14 : 12} />
        </span>
      );
    }),
  );
}

function Orbit({ summary }: { summary: CapabilitySummary }) {
  return (
    <div aria-hidden="true" className="relative h-full w-[340px] shrink-0">
      <div className="absolute top-[-6px] left-[40px] size-[260px] rounded-full bg-[radial-gradient(50%_50%_at_50%_50%,color-mix(in_srgb,var(--fx-accent-blue)_28%,transparent)_0%,color-mix(in_srgb,var(--fx-accent-blue)_8%,transparent)_45%,transparent_70%)]" />
      <div className="absolute top-[32px] left-[78px] size-[184px] rounded-full border border-dashed border-[var(--fx-line-translucent)]" />
      <div className="absolute top-[70px] left-[116px] size-[108px] rounded-full border border-solid border-[var(--fx-line-translucent)]" />
      <img
        src={appIconUrl}
        alt=""
        width={60}
        height={60}
        className="absolute top-[94px] left-[140px] size-[60px] rounded-[var(--radius-hero)] border border-solid border-[var(--fx-line-translucent)] shadow-[0_0_0_6px_color-mix(in_srgb,var(--fx-accent-blue)_10%,transparent),0_10px_40px_0_color-mix(in_srgb,var(--fx-accent-blue)_45%,transparent)]"
      />
      <OrbitTiles summary={summary} />
      {summary.hidden > 0 && (
        <span
          data-orbit-kind="hidden"
          className="absolute top-[213px] left-[167px] size-[6px] rounded-[3px] bg-[var(--fx-text-faint)]"
        />
      )}
      {summary.unavailable > 0 && (
        <span
          data-orbit-kind="unavailable"
          className="absolute top-[121px] left-[221px] size-[6px] rounded-[3px] bg-[var(--fx-status-warning)] opacity-70"
        />
      )}
    </div>
  );
}

export function OverviewHero({ summary }: { summary: CapabilitySummary }) {
  const { language, t } = useI18n();
  const note = footnote(summary, language, t);
  return (
    <section
      aria-label={t("resourcesCapabilityOverview", "Capability overview")}
      className="flex h-[248px] w-full items-center overflow-hidden rounded-[var(--radius-resource-hero)] border border-solid border-[var(--fx-line-default)] bg-[linear-gradient(120deg,var(--fx-surface-raised)_0%,var(--fx-surface-hero-tint)_100%)] shadow-[inset_0_1px_0_0_color-mix(in_srgb,var(--fx-text-on-accent)_4%,transparent)]"
    >
      <div className="flex h-full min-w-0 flex-1 flex-col justify-center gap-[18px] py-[28px] pl-[32px]">
        <span className="type-label-medium text-[var(--fx-text-tertiary)]">
          {t("resourcesCapabilityOverview", "Capability overview")}
        </span>
        <div className="flex items-end gap-[10px]">
          <span className="type-title-stat text-[var(--fx-text-primary)]">{formatNumber(summary.ready, language)}</span>
          <span className="type-body-large text-[var(--fx-text-secondary)]">
            {t("resourcesCapabilitiesReady", "capabilities ready")}
          </span>
        </div>
        <ul className="m-0 flex list-none items-center gap-[18px] p-0">
          {legend(summary, t).map((item) => (
            <li key={item.key} className="flex items-center gap-[7px]">
              <span
                aria-hidden="true"
                className="size-[8px] rounded-[4px]"
                style={{
                  background: item.color,
                  boxShadow: `0 0 8px 0 color-mix(in srgb, ${item.color} 40%, transparent)`,
                }}
              />
              <span className="type-body-default text-[var(--fx-text-secondary)]">{item.label}</span>
              <span className="type-mono-body text-[var(--fx-text-primary)]">{formatNumber(item.count, language)}</span>
            </li>
          ))}
        </ul>
        {note && (
          <p className="m-0 flex items-center gap-[6px]">
            <EyeOffIcon size={13} className="text-[var(--fx-text-tertiary)]" />
            <span className="type-label-default text-[var(--fx-text-tertiary)]">{note}</span>
          </p>
        )}
      </div>
      <Orbit summary={summary} />
    </section>
  );
}
