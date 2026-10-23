import { useCallback, useEffect, useRef, type CSSProperties, type MouseEvent } from "react";
import { useI18n } from "@/i18n";
import { ChevronDownIcon, CompactIcon, Icon } from "./icons";

const THINKING_LEVELS = ["auto", "off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
type ThinkingLevel = (typeof THINKING_LEVELS)[number];

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

const THINKING_TONES: Record<ThinkingLevel, string> = {
  auto: "var(--fx-text-secondary)",
  off: "var(--fx-text-secondary)",
  minimal: "var(--fx-data-slate)",
  low: "var(--fx-data-blue)",
  medium: "var(--fx-data-indigo)",
  high: "var(--fx-data-violet)",
  xhigh: "var(--fx-data-fuchsia)",
  max: "var(--fx-data-fuchsia)",
};
const THINKING_FILL: Partial<Record<ThinkingLevel, number[]>> = {
  minimal: [3, 36],
  low: [3, 42],
  medium: [3, 55],
  high: [6, 54],
  xhigh: [6, 60],
};
const labelTone = (level: ThinkingLevel) => (level === "max" ? "var(--fx-data-cyan)" : THINKING_TONES[level]);

const tint = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

function thinkingFill(level: ThinkingLevel): string {
  const [from, to] = THINKING_FILL[level] ?? [0, 0];
  if (level === "max") {
    return `linear-gradient(90deg, ${tint("var(--fx-data-indigo)", 55)} 0%, ${tint("var(--fx-data-violet)", 65)} 55%, ${tint("var(--fx-data-fuchsia)", 75)} 100%)`;
  }
  return `linear-gradient(90deg, ${tint(THINKING_TONES[level], from)} 0%, ${tint(THINKING_TONES[level], to)} 100%)`;
}

const TICK: CSSProperties = { width: 4, height: 4, borderRadius: 2, background: "var(--fx-control-tick)" };

const CARD: CSSProperties = { bottom: "calc(100% + 8px)", zIndex: 100, transformOrigin: "bottom right", gap: 14 };
const MAX_CARD: CSSProperties = {
  background: "linear-gradient(160deg, var(--fx-surface-raised) 35%, var(--fx-data-purple-surface) 100%)",
  border: "1px solid var(--fx-data-fuchsia-line)",
  boxShadow: `var(--shadow-picker), 0 0 36px 0 ${tint("var(--fx-data-violet)", 20)}`,
};
const PLAIN_CARD: CSSProperties = { background: "var(--fx-surface-raised)", boxShadow: "var(--shadow-picker)" };
const FILL: CSSProperties = {
  position: "absolute",
  inset: "0 auto 0 0",
  borderRadius: "var(--radius-card)",
  transition: "width var(--duration-glide, 220ms) var(--ease-smooth-out, ease)",
  pointerEvents: "none",
};
const AUTO_CHIP: CSSProperties = {
  height: 22,
  padding: "0 var(--space-2)",
  border: "1px solid var(--fx-line-strong)",
  borderRadius: "var(--radius-chip)",
  cursor: "pointer",
  whiteSpace: "nowrap",
};
const QUICK = "var(--duration-quick, 150ms) var(--ease-smooth-out, ease)";
const HOVER = "var(--fx-surface-hover-overlay)";
const CLEAR = "var(--fx-surface-hover-clear)";
const paint = (e: MouseEvent<HTMLElement>, background: string) => (e.currentTarget.style.background = background);

const GHOST: CSSProperties = {
  border: "none",
  borderRadius: "var(--radius-control)",
  transition: `background ${QUICK}, opacity ${QUICK}`,
};
const GHOST_CLASS = "flex min-h-[30px] items-center justify-center gap-1.5";

const BRAIN_PATH =
  "M12 18V5M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5M17.997 5.125a4 4 0 0 1 2.526 5.77M18 18a4 4 0 0 0 2-7.464M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517M6 18a4 4 0 0 1-2-7.464M6.003 5.125a4 4 0 0 0-2.526 5.77";

function BrainThumb({ alpha }: { alpha: number }) {
  return (
    <svg width={30} height={30} viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
      <path
        opacity={alpha}
        d="M240,124a48,48,0,0,1-32,45.27V176a40,40,0,0,1-80,0,40,40,0,0,1-80,0v-6.73a48,48,0,0,1,0-90.54V72a40,40,0,0,1,80,0,40,40,0,0,1,80,0v6.73A48,48,0,0,1,240,124Z"
      />
      <path d="M248,124a56.11,56.11,0,0,0-32-50.61V72a48,48,0,0,0-88-26.49A48,48,0,0,0,40,72v1.39a56,56,0,0,0,0,101.2V176a48,48,0,0,0,88,26.49A48,48,0,0,0,216,176v-1.41A56.09,56.09,0,0,0,248,124ZM88,208a32,32,0,0,1-31.81-28.56A55.87,55.87,0,0,0,64,180h8a8,8,0,0,0,0-16H64A40,40,0,0,1,50.67,86.27,8,8,0,0,0,56,78.73V72a32,32,0,0,1,64,0v68.26A47.8,47.8,0,0,0,88,128a8,8,0,0,0,0,16,32,32,0,0,1,0,64Zm104-44h-8a8,8,0,0,0,0,16h8a55.87,55.87,0,0,0,7.81-.56A32,32,0,1,1,168,144a8,8,0,0,0,0-16,47.8,47.8,0,0,0-32,12.26V72a32,32,0,0,1,64,0v6.73a8,8,0,0,0,5.33,7.54A40,40,0,0,1,192,164Zm16-52a8,8,0,0,1-8,8h-4a36,36,0,0,1-36-36V80a8,8,0,0,1,16,0v4a20,20,0,0,0,20,20h4A8,8,0,0,1,208,112ZM60,120H56a8,8,0,0,1,0-16h4A20,20,0,0,0,80,84V80a8,8,0,0,1,16,0v4A36,36,0,0,1,60,120Z" />
    </svg>
  );
}

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
    off: t("thinkingOffDescription", "Reasoning off"),
    minimal: t("thinkingMinimalDescription", "Minimal reasoning"),
    low: t("thinkingLowDescription", "Low reasoning"),
    medium: t("thinkingMediumDescription", "Medium reasoning"),
    high: t("thinkingHighDescription", "High reasoning"),
    xhigh: t("thinkingXHighDescription", "Extra-high reasoning"),
    max: t("thinkingMaxDescription", "Maximum reasoning"),
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
              title={t("sessionCollaborationThinking", "Thinking level")}
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
  current: ThinkingLevel;
  currentLabel: string;
  description: string;
  options: { level: ThinkingLevel; label: string; description: string }[];
  onPick: (level: ThinkingLevel) => void;
}

function ThinkingCard({ label, title, current, currentLabel, description, options, onPick }: ThinkingCardProps) {
  const auto = options.find((option) => option.level === "auto");
  const stops = options.filter((option) => option.level !== "auto");
  const activeIndex = stops.findIndex((option) => option.level === current);
  const isMax = current === "max";
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
        border: "1px solid var(--fx-line-default)",
        ...(isMax ? MAX_CARD : PLAIN_CARD),
        padding: "var(--space-4)",
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
      </div>
      {stops.length > 0 && (
        <div
          className="relative flex h-9 justify-between overflow-hidden"
          style={{
            borderRadius: "var(--radius-card)",
            background: resting ? "var(--fx-surface-card)" : "var(--fx-surface-selected)",
          }}
        >
          <span aria-hidden="true" style={{ ...FILL, width: fillWidth, background: thinkingFill(current) }} />
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
                className="relative flex h-9 w-10 cursor-pointer items-center justify-center border-none bg-transparent p-0"
                style={{ color: THINKING_TONES[current] }}
              >
                <span className="sr-only">{option.label}</span>
                {active ? (
                  <BrainThumb alpha={option.level === "off" ? 0 : 0.45} />
                ) : (
                  <span aria-hidden="true" style={TICK} />
                )}
              </button>
            );
          })}
        </div>
      )}
      <span className="type-label-default" style={{ color: "var(--fx-text-tertiary)" }}>
        {description}
      </span>
    </div>
  );
}
