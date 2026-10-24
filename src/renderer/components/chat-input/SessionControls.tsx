import { useCallback, useEffect, useRef, type CSSProperties } from "react";
import { useI18n } from "@/i18n";
import { ChevronDownIcon, CompactIcon, Icon } from "./icons";
import { CLEAR, HOVER, paint, QUICK } from "./menu-chrome";
import {
  THINKING_LEVELS,
  THINKING_TONES,
  ThinkingFill,
  ThinkingThumb,
  labelTone,
  tint,
  type ThinkingLevel,
} from "./thinking-art";

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
  onCompact?: () => void;
  onAbortCompaction?: () => void;
  isCompacting?: boolean;
  compactError?: string | null;
  contextUsage?: { percent: number | null; contextWindow: number; tokens: number | null } | null;
  /* sound */
  soundEnabled?: boolean;
  onSoundToggle?: () => void;
}

const TICK: CSSProperties = { width: 4, height: 4, borderRadius: 2, background: "var(--fx-control-tick)" };

const CARD: CSSProperties = { bottom: "calc(100% + 8px)", zIndex: 100, transformOrigin: "bottom right", gap: 14 };
const SPECIAL_CARD: Partial<Record<ThinkingLevel, CSSProperties>> = {
  xhigh: {
    background: "linear-gradient(160deg, var(--fx-surface-raised) 50%, var(--fx-data-fuchsia-surface) 100%)",
    border: "1px solid var(--fx-data-fuchsia-line)",
    boxShadow: "var(--shadow-picker)",
  },
  max: {
    background: "linear-gradient(160deg, var(--fx-surface-raised) 35%, var(--fx-data-purple-surface) 100%)",
    border: "1px solid var(--fx-data-fuchsia-line)",
    boxShadow: `var(--shadow-picker), 0 0 36px 0 ${tint("var(--fx-data-violet)", 20)}`,
  },
};
const PLAIN_CARD: CSSProperties = {
  background: "var(--fx-surface-raised)",
  border: "1px solid var(--fx-line-default)",
  boxShadow: "var(--shadow-picker)",
};
const TRACK: CSSProperties = { width: 308, height: 36, borderRadius: "var(--radius-card)" };
const STOP: CSSProperties = { width: 40, height: 36 };
const HELP: CSSProperties = { color: "var(--fx-text-secondary)", cursor: "help" };
const AUTO_CHIP: CSSProperties = {
  height: 22,
  padding: "0 var(--space-2)",
  border: "1px solid var(--fx-line-strong)",
  borderRadius: "var(--radius-chip)",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const GHOST: CSSProperties = {
  border: "none",
  borderRadius: "var(--radius-control)",
  transition: `background ${QUICK}, opacity ${QUICK}`,
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
    onCompact,
    onAbortCompaction,
    isCompacting,
    compactError,
    contextUsage,
    soundEnabled,
    onSoundToggle,
  } = props;
  const { t } = useI18n();
  const focusFrameIdsRef = useRef<Set<number>>(new Set());
  const cancelFocusFrames = useCallback(() => {
    for (const frameId of focusFrameIdsRef.current) globalThis.cancelAnimationFrame?.(frameId);
    focusFrameIdsRef.current.clear();
  }, []);
  const focusThinkingButtonAfterPaint = useCallback(() => {
    if (!visible || typeof globalThis.requestAnimationFrame !== "function") return;
    let frameId = 0;
    frameId = globalThis.requestAnimationFrame(() => {
      focusFrameIdsRef.current.delete(frameId);
      if (visible) thinkingButtonRef.current?.focus();
    });
    focusFrameIdsRef.current.add(frameId);
  }, [thinkingButtonRef, visible]);
  useEffect(() => {
    if (!visible) cancelFocusFrames();
    return cancelFocusFrames;
  }, [cancelFocusFrames, visible]);

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
  const contextWindowTokens = contextUsage?.contextWindow ?? null;
  const compactUrgency = compactUrgencyOf(contextPct);
  const compactRest = isCompacting ? tint("var(--fx-status-danger)", 8) : CLEAR;
  const compactHover = isCompacting ? tint("var(--fx-status-danger)", 16) : mixWarning(compactUrgency, 24, HOVER);
  const soundLabel = soundEnabled
    ? t("disableCompletionSound", "Disable completion sound")
    : t("enableCompletionSound", "Enable completion sound");
  // Option A: keep the capacity visible and mark the usage explicitly unknown
  // (e.g. right after compaction) instead of hiding the numbers entirely.
  const compactTitle = isCompacting
    ? t("stopCompaction", "Stop compaction")
    : contextPct === null && contextWindowTokens !== null
      ? t(
          "contextUsagePendingHint",
          "Context usage updates after the next model response (e.g. right after compaction)",
        )
      : t("compact", "Compact context");

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
              ...GHOST,
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
            <span className="flex" style={{ color: THINKING_TONES[currentLevel] }}>
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
          {thinkingDropdownOpen && (
            <ThinkingCard
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
                if (!visible) return;
                if (lvl !== currentLevel) onThinkingLevelChange(lvl);
                onThinkingToggle();
                focusThinkingButtonAfterPaint();
              }}
            />
          )}
        </div>
      )}

      {onCompact && (
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
          <button
            type="button"
            onClick={() => {
              if (!visible) return;
              closeDropdowns();
              if (isCompacting) onAbortCompaction?.();
              else onCompact();
            }}
            disabled={isStreaming && !isCompacting}
            title={compactTitle}
            aria-label={compactTitle}
            className={`type-label-default ${GHOST_CLASS}`}
            style={{
              ...GHOST,
              minWidth: 30,
              padding: isMobile ? 0 : "0 var(--space-2)",
              background: compactRest,
              color: isCompacting
                ? "var(--fx-status-danger)"
                : mixWarning(compactUrgency, 100, "var(--fx-text-secondary)"),
              cursor: isStreaming && !isCompacting ? "not-allowed" : "pointer",
              opacity: isStreaming && !isCompacting ? 0.5 : 1,
            }}
            onMouseEnter={(e) => !(isStreaming && !isCompacting) && paint(e, compactHover)}
            onMouseLeave={(e) => paint(e, compactRest)}
          >
            {isCompacting ? <span className="size-2.5 rounded-[2px] bg-current" /> : <CompactIcon size={13} />}
            {!isMobile && (
              <span style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                {isCompacting
                  ? t("compacting", "Compacting…")
                  : contextWindowTokens !== null
                    ? `${contextPct !== null ? `${contextPct.toFixed(1)}%` : "?"}/${formatTokenCount(contextWindowTokens)} · ${t("compactAction", "Compact")}`
                    : t("compactAction", "Compact")}
              </span>
            )}
          </button>
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

interface ThinkingCardProps {
  label: string;
  title: string;
  help: string;
  fasterLabel: string;
  smarterLabel: string;
  current: ThinkingLevel;
  currentLabel: string;
  description: string;
  options: { level: ThinkingLevel; label: string; description: string }[];
  onPick: (level: ThinkingLevel) => void;
}

function ThinkingCard(props: ThinkingCardProps) {
  const { label, title, help, fasterLabel, smarterLabel, current, currentLabel, description, options, onPick } = props;
  const auto = options.find((option) => option.level === "auto");
  const stops = options.filter((option) => option.level !== "auto");
  const activeIndex = stops.findIndex((option) => option.level === current);
  const isAuto = current === "auto";
  const resting = isAuto || current === "off";
  const autoRest = isAuto ? "var(--fx-surface-selected)" : CLEAR;
  const headingColor = resting ? "var(--fx-text-tertiary)" : labelTone(current);
  const fillWidth =
    activeIndex <= 0 || stops[activeIndex]?.level === "off"
      ? "0px"
      : `calc((100% - 40px) * ${activeIndex / Math.max(1, stops.length - 1)} + 38px)`;
  return (
    <div
      role="menu"
      aria-label={label}
      className="composer-pop-in absolute right-0 box-border flex w-[340px] flex-col overflow-hidden"
      style={{
        ...CARD,
        ...(SPECIAL_CARD[current] ?? PLAIN_CARD),
        padding: "calc(var(--space-4) - 1px)",
        borderRadius: "var(--radius-composer)",
      }}
    >
      <div className="flex items-center" style={{ gap: "var(--space-2)" }}>
        <span className="type-body-large" style={{ color: "var(--fx-text-secondary)", whiteSpace: "nowrap" }}>
          {title}
        </span>
        <span className="type-heading" style={{ color: headingColor, whiteSpace: "nowrap" }}>
          {currentLabel}
        </span>
        <span className="flex-1" />
        {auto && (
          <button
            type="button"
            role="menuitemradio"
            aria-checked={isAuto}
            title={auto.description}
            onClick={() => onPick("auto")}
            className="type-label-default"
            style={{
              ...AUTO_CHIP,
              background: autoRest,
              color: isAuto ? "var(--fx-text-primary)" : "var(--fx-text-secondary)",
            }}
            onMouseEnter={(e) => !isAuto && paint(e, HOVER)}
            onMouseLeave={(e) => paint(e, autoRest)}
          >
            {auto.label}
          </button>
        )}
        <span role="img" aria-label={help} title={help} className="flex" style={HELP}>
          <Icon size={15} strokeWidth={1.75}>
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01" />
          </Icon>
        </span>
      </div>
      {stops.length > 0 && (
        <div className="flex flex-col" style={{ gap: "var(--space-2)" }}>
          <div className="type-label-default flex justify-between" style={{ color: "var(--fx-text-tertiary)" }}>
            <span>{fasterLabel}</span>
            <span>{smarterLabel}</span>
          </div>
          <div
            className="relative flex justify-between"
            style={{ ...TRACK, background: resting ? "var(--fx-surface-card)" : "var(--fx-surface-selected)" }}
          >
            <ThinkingFill level={current} width={fillWidth} />
            {stops.map((option, index) => {
              const active = index === activeIndex;
              return (
                <button
                  key={option.level}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  title={option.description}
                  onClick={() => onPick(option.level)}
                  className="relative flex flex-none cursor-pointer items-center justify-center border-none bg-transparent p-0"
                  style={{ ...STOP, color: THINKING_TONES[current] }}
                >
                  <span className="sr-only">{option.label}</span>
                  {active ? <ThinkingThumb level={option.level} /> : <span aria-hidden="true" style={TICK} />}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <span className="type-label-default" style={{ color: "var(--fx-text-tertiary)" }}>
        {description}
      </span>
    </div>
  );
}
