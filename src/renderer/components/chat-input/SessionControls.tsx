import type { CSSProperties } from "react";
import { useI18n } from "@/i18n";
import { formatUsagePercent } from "../app-shell/usage-format";
import { ChevronDownIcon, CompactIcon, Icon } from "./icons";
import { CLEAR, HOVER, paint, QUICK } from "./menu-chrome";
import { THINKING_LEVELS, THINKING_TONES, labelTone, tint, type ThinkingLevel } from "./thinking-art";
import { ThinkingCard, useClosingCard } from "./thinking-card";

export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return tokens.toLocaleString();
}

/* Context fill ramps the Compact chip toward the warning color:
   0 below half the window, full warning at 90%+. Gradual, no steps. */
function compactUrgencyOf(percent: number | null): number {
  if (percent === null || Number.isNaN(percent)) return 0;
  return Math.min(1, Math.max(0, (percent - 50) / 40));
}

function mixWarning(urgency: number, strength: number, base: string): string {
  const pct = Math.round(urgency * strength);
  return pct > 0 ? `color-mix(in srgb, var(--fx-status-warning) ${pct}%, ${base})` : base;
}

export interface SessionControlsProps {
  visible: boolean;
  isMobile: boolean;
  isStreaming: boolean;
  closeDropdowns: () => void;
  /* thinking level */
  thinkingLevel: ThinkingLevel | "auto" | undefined;
  onThinkingLevelChange?: ((level: ThinkingLevel) => void) | undefined;
  availableThinkingLevels?: string[] | null;
  thinkingLevelMap?: Record<string, string | null> | null;
  thinkingDropdownOpen: boolean;
  onThinkingToggle: () => void;
  thinkingContainerRef: { current: HTMLDivElement | null };
  thinkingButtonRef: { current: HTMLButtonElement | null };
  /* compaction */
  onOpenUsage?: () => void;
  isCompacting?: boolean;
  compactError?: string | null;
  contextUsage?: { percent: number | null; contextWindow: number; tokens: number | null } | null;
  /* sound */
  soundEnabled?: boolean;
  onSoundToggle?: () => void;
}

const GHOST: CSSProperties = {
  border: "none",
  borderRadius: "var(--radius-control)",
  transition: `background ${QUICK}, opacity ${QUICK}`,
};
const THINKING_TRIGGER: CSSProperties = {
  ...GHOST,
  transition: `background ${QUICK}, opacity ${QUICK}, color var(--duration-spring-glide) var(--ease-spring-glide)`,
};
const GHOST_CLASS = "flex min-h-[30px] items-center justify-center gap-[6px]";

const BRAIN_PATH =
  "M12 18V5M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5M17.997 5.125a4 4 0 0 1 2.526 5.77M18 18a4 4 0 0 0 2-7.464M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517M6 18a4 4 0 0 1-2-7.464M6.003 5.125a4 4 0 0 0-2.526 5.77";

/** Session-scoped controls below the composer: reasoning level, context
 *  compaction, completion sound. Ghost chips — chrome only on hover. */
export function SessionControls(props: SessionControlsProps) {
  const {
    visible,
    isMobile,
    isStreaming,
    closeDropdowns,
    thinkingLevel,
    onThinkingLevelChange,
    availableThinkingLevels,
    thinkingLevelMap,
    thinkingDropdownOpen,
    onThinkingToggle,
    thinkingContainerRef,
    thinkingButtonRef,
    onOpenUsage,
    isCompacting,
    compactError,
    contextUsage,
    soundEnabled,
    onSoundToggle,
  } = props;
  const { t } = useI18n();
  const thinkingCardClosing = useClosingCard(thinkingDropdownOpen, visible);

  const thinkingLabels: Record<ThinkingLevel, string> = {
    auto: t("thinkingAuto", "Auto"),
    off: t("thinkingOff", "Off"),
    minimal: t("thinkingMinimal", "Minimal"),
    low: t("thinkingLow", "Low"),
    medium: t("thinkingMedium", "Medium"),
    high: t("thinkingHigh", "High"),
    xhigh: t("thinkingXHigh", "Extra high"),
    max: t("thinkingMax", "Max"),
  };
  const thinkingDescriptions: Record<ThinkingLevel, string> = {
    auto: t("thinkingDefaultDescription", "Use Pi default"),
    off: t("thinkingOffDescription", "Reasoning off, fastest replies"),
    minimal: t("thinkingMinimalDescription", "Minimal reasoning"),
    low: t("thinkingLowDescription", "Low reasoning"),
    medium: t("thinkingMediumDescription", "Medium reasoning"),
    high: t("thinkingHighDescription", "High reasoning, slower replies"),
    xhigh: t("thinkingXHighDescription", "Extra-high reasoning, uses more tokens"),
    max: t("thinkingMaxDescription", "Maximum reasoning, for the hardest problems"),
  };
  const translateThinkingValue = (value: string): string =>
    (THINKING_LEVELS as readonly string[]).includes(value) ? thinkingLabels[value as ThinkingLevel] : value;
  const thinkingDisplayLabel = (() => {
    const lvl = thinkingLevel ?? "auto";
    if (lvl === "auto" || !thinkingLevelMap) return thinkingLabels[lvl];
    return translateThinkingValue(thinkingLevelMap[lvl] ?? lvl);
  })();

  const currentLevel: ThinkingLevel = thinkingLevel ?? "auto";
  const thinkingOptions = THINKING_LEVELS.filter(
    (lvl) => !availableThinkingLevels || lvl === "auto" || availableThinkingLevels.includes(lvl),
  ).map((lvl) => {
    const mappedVal = lvl !== "auto" && thinkingLevelMap ? thinkingLevelMap[lvl] : undefined;
    const showOriginal = mappedVal != null && mappedVal !== lvl;
    const displayLabel = translateThinkingValue(showOriginal ? mappedVal : lvl);
    return {
      level: lvl,
      label: showOriginal ? `${displayLabel} (${thinkingLabels[lvl]})` : displayLabel,
      description: thinkingDescriptions[lvl],
    };
  });

  const contextPct = contextUsage?.percent ?? null;
  const compactUrgency = compactUrgencyOf(contextPct);
  const usageHintVisible =
    onOpenUsage !== undefined && (isCompacting === true || (contextPct !== null && contextPct > 80));
  const usageHintText = isCompacting
    ? t("compacting", "Compacting…")
    : t("contextUsageHint", "Context {percent}").replace("{percent}", formatUsagePercent(contextPct ?? 0));
  const soundLabel = soundEnabled
    ? t("disableCompletionSound", "Disable completion sound")
    : t("enableCompletionSound", "Enable completion sound");

  return (
    <div
      className={`relative flex flex-none items-center justify-end ${isMobile ? "gap-0.5" : "ml-auto"}`}
      style={{ gap: isMobile ? undefined : "var(--space-3)" }}
    >
      {onThinkingLevelChange && (
        <div ref={thinkingContainerRef} className="relative flex">
          <button
            ref={thinkingButtonRef}
            type="button"
            aria-haspopup="menu"
            aria-expanded={thinkingDropdownOpen}
            onClick={onThinkingToggle}
            disabled={isStreaming}
            title={`${t("changeThinkingLevel", "Change reasoning level")}: ${thinkingDisplayLabel}`}
            aria-label={`${t("changeThinkingLevel", "Change reasoning level")}: ${thinkingDisplayLabel}`}
            className={`type-body-medium ${GHOST_CLASS}`}
            style={{
              ...THINKING_TRIGGER,
              background: thinkingDropdownOpen ? HOVER : CLEAR,
              minWidth: 30,
              padding: isMobile ? 0 : "0 var(--space-2)",
              color: labelTone(currentLevel),
              cursor: isStreaming ? "not-allowed" : "pointer",
              opacity: isStreaming ? 0.5 : 1,
            }}
            onMouseEnter={(e) => !isStreaming && paint(e, HOVER)}
            onMouseLeave={(e) => paint(e, thinkingDropdownOpen ? HOVER : CLEAR)}
          >
            <span className="thinking-glide flex" style={{ color: THINKING_TONES[currentLevel] }}>
              <Icon size={14} strokeWidth={1.75}>
                <path d={BRAIN_PATH} />
              </Icon>
            </span>
            {!isMobile && <span style={{ whiteSpace: "nowrap" }}>{thinkingDisplayLabel}</span>}
            {!isMobile && (
              <span className="flex" style={{ color: "var(--fx-text-tertiary)" }}>
                <ChevronDownIcon size={12} />
              </span>
            )}
          </button>
          {(thinkingDropdownOpen || thinkingCardClosing) && (
            <ThinkingCard
              closing={!thinkingDropdownOpen}
              label={t("changeThinkingLevel", "Change reasoning level")}
              title={t("thinkingCardTitle", "Reasoning effort")}
              help={t("thinkingCardHelp", "Higher effort thinks longer before replying; Auto uses the Pi default")}
              fasterLabel={t("thinkingFaster", "Faster")}
              smarterLabel={t("thinkingSmarter", "Smarter")}
              current={currentLevel}
              currentLabel={thinkingDisplayLabel}
              description={thinkingDescriptions[currentLevel]}
              options={thinkingOptions}
              onPick={(lvl) => {
                if (visible && lvl !== currentLevel) onThinkingLevelChange(lvl);
              }}
            />
          )}
        </div>
      )}

      {(compactError || usageHintVisible) && (
        <div className="relative">
          {compactError && (
            <div
              className="type-meta-default"
              style={{
                position: "absolute",
                bottom: "calc(100% + 6px)",
                right: 0,
                background: "var(--fx-status-danger-soft)",
                color: "var(--fx-status-danger-text)",
                padding: "var(--space-1) var(--space-2)",
                borderRadius: "var(--radius-control)",
                whiteSpace: "nowrap",
                pointerEvents: "none",
                boxShadow: "var(--shadow-card)",
                zIndex: 50,
              }}
            >
              {compactError}
            </div>
          )}
          {usageHintVisible && (
            <button
              type="button"
              onClick={() => {
                if (!visible) return;
                closeDropdowns();
                onOpenUsage?.();
              }}
              title={t("contextAndCost", "View context and cost")}
              className={`type-label-default ${GHOST_CLASS}`}
              style={{
                ...GHOST,
                gap: 4,
                padding: "0 var(--space-2)",
                color: isCompacting
                  ? "var(--fx-status-danger)"
                  : mixWarning(compactUrgency, 100, "var(--fx-text-secondary)"),
                cursor: "pointer",
              }}
              onMouseEnter={(e) =>
                paint(e, isCompacting ? tint("var(--fx-status-danger)", 16) : mixWarning(compactUrgency, 24, HOVER))
              }
              onMouseLeave={(e) => paint(e, CLEAR)}
            >
              <CompactIcon size={13} />
              <span style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{usageHintText}</span>
            </button>
          )}
        </div>
      )}

      {onSoundToggle !== undefined && (
        <button
          type="button"
          aria-pressed={soundEnabled === true}
          onClick={() => {
            if (!visible) return;
            closeDropdowns();
            onSoundToggle();
          }}
          title={soundLabel}
          aria-label={soundLabel}
          className={GHOST_CLASS}
          style={{
            ...GHOST,
            width: 30,
            height: 30,
            padding: 0,
            color: "var(--fx-text-tertiary)",
            cursor: "pointer",
            opacity: soundEnabled ? 1 : 0.55,
          }}
          onMouseEnter={(e) => paint(e, HOVER)}
          onMouseLeave={(e) => paint(e, CLEAR)}
        >
          <Icon size={15} strokeWidth={1.75}>
            <path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" />
            {soundEnabled ? (
              <path d="M16 9a5 5 0 0 1 0 6M19.364 18.364a9 9 0 0 0 0-12.728" />
            ) : (
              <path d="M22 9l-6 6M16 9l6 6" />
            )}
          </Icon>
        </button>
      )}
    </div>
  );
}
