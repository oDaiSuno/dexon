import { useI18n, type AppLanguage } from "@/i18n";
import { formatNumber } from "@/lib/locale-format";
import appIconUrl from "../../../../build/icon.png";
import type { CapabilitySummary } from "./overview-model";
import { InfoIcon } from "./overview-icons";

type Translate = (key: string, fallback: string) => string;

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

function Orbit() {
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
            <InfoIcon size={13} className="text-[var(--fx-text-tertiary)]" />
            <span className="type-label-default text-[var(--fx-text-tertiary)]">{note}</span>
          </p>
        )}
      </div>
      <Orbit />
    </section>
  );
}
