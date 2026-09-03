import type { CSSProperties, MouseEvent } from "react";
import { useI18n } from "@/i18n";
import { scaledChatFont } from "@/lib/chat-appearance";
import { CompactIcon, LightbulbIcon, SpeakerOffIcon, SpeakerOnIcon } from "./icons";

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
  return pct > 0 ? `color-mix(in srgb, var(--warning) ${pct}%, ${base})` : base;
}

export interface SessionControlsProps {
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

function ghostChip(open: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    minHeight: 32,
    background: open ? "var(--bg-selected)" : "transparent",
    border: "none",
    borderRadius: "var(--radius-control)",
    color: "var(--text-muted)",
    transition: "background 0.12s, color 0.12s, opacity 0.12s",
  };
}

function ghostHover(e: MouseEvent<HTMLButtonElement>, { open, disabled }: { open: boolean; disabled?: boolean }) {
  if (disabled) return;
  e.currentTarget.style.background = open ? "var(--bg-selected)" : "var(--bg-hover)";
  e.currentTarget.style.color = "var(--text)";
}

function ghostLeave(e: MouseEvent<HTMLButtonElement>, { open, color }: { open: boolean; color: string }) {
  e.currentTarget.style.background = open ? "var(--bg-selected)" : "transparent";
  e.currentTarget.style.color = color;
}

/** Session-scoped controls below the composer: reasoning level, context
 *  compaction, completion sound. Ghost chips — chrome only on hover. */
export function SessionControls(props: SessionControlsProps) {
  const {
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

  const contextPct = contextUsage?.percent ?? null;
  const contextWindowTokens = contextUsage?.contextWindow ?? null;
  const compactUrgency = compactUrgencyOf(contextPct);

  return (
    <div
      style={{
        flex: "0 0 auto",
        display: "flex",
        alignItems: "center",
        gap: isMobile ? 2 : 6,
        justifyContent: "flex-end",
        position: "relative",
        marginLeft: isMobile ? 0 : "auto",
      }}
    >
      {onThinkingLevelChange && (
        <div ref={thinkingContainerRef} style={{ position: "relative", display: "flex" }}>
          <button
            ref={thinkingButtonRef}
            type="button"
            aria-haspopup="menu"
            aria-expanded={thinkingDropdownOpen}
            onClick={onThinkingToggle}
            disabled={isStreaming}
            title={`${t("changeThinkingLevel", "Change reasoning level")}: ${thinkingDisplayLabel}`}
            aria-label={`${t("changeThinkingLevel", "Change reasoning level")}: ${thinkingDisplayLabel}`}
            style={{
              ...ghostChip(thinkingDropdownOpen),
              padding: isMobile ? 0 : "0 9px",
              cursor: isStreaming ? "not-allowed" : "pointer",
              fontSize: scaledChatFont(12),
              opacity: isStreaming ? 0.5 : 1,
            }}
            onMouseEnter={(e) => ghostHover(e, { open: thinkingDropdownOpen, disabled: isStreaming })}
            onMouseLeave={(e) => ghostLeave(e, { open: thinkingDropdownOpen, color: "var(--text-muted)" })}
          >
            <LightbulbIcon size={11} />
            {!isMobile && <span style={{ whiteSpace: "nowrap" }}>{thinkingDisplayLabel}</span>}
          </button>
          {thinkingDropdownOpen && (
            <div
              role="menu"
              aria-label={t("changeThinkingLevel", "Change reasoning level")}
              style={{
                position: "absolute",
                bottom: "calc(100% + 6px)",
                right: 0,
                zIndex: 100,
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-card)",
                boxShadow: "0 -4px 16px rgba(0,0,0,0.10)",
                overflow: "hidden",
                minWidth: 180,
              }}
            >
              {THINKING_LEVELS.filter((lvl) => {
                if (!availableThinkingLevels) return true;
                if (lvl === "auto") return true;
                return availableThinkingLevels.includes(lvl);
              }).map((lvl) => {
                const isActive = (thinkingLevel ?? "auto") === lvl;
                const desc = thinkingDescriptions[lvl];
                const mappedVal = lvl !== "auto" && thinkingLevelMap ? thinkingLevelMap[lvl] : undefined;
                const displayLabel = translateThinkingValue(mappedVal != null && mappedVal !== lvl ? mappedVal : lvl);
                const showOriginal = mappedVal != null && mappedVal !== lvl;
                return (
                  <button
                    key={lvl}
                    type="button"
                    role="menuitemradio"
                    aria-checked={isActive}
                    onClick={() => {
                      if (!isActive) onThinkingLevelChange(lvl);
                      onThinkingToggle();
                      requestAnimationFrame(() => thinkingButtonRef.current?.focus());
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      width: "100%",
                      padding: "8px 12px",
                      background: isActive ? "var(--bg-selected)" : "none",
                      border: "none",
                      color: isActive ? "var(--text)" : "var(--text-muted)",
                      cursor: "pointer",
                      fontSize: scaledChatFont(12),
                      textAlign: "left",
                      fontWeight: isActive ? 600 : 400,
                      whiteSpace: "nowrap",
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) e.currentTarget.style.background = "var(--bg-hover)";
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) e.currentTarget.style.background = "none";
                    }}
                  >
                    {isActive ? <CheckDot /> : <span style={{ width: 10, flexShrink: 0 }} />}
                    <span style={{ flex: 1 }}>
                      {displayLabel}
                      {showOriginal && (
                        <span
                          style={{
                            fontSize: scaledChatFont(10),
                            color: "var(--text-dim)",
                            fontFamily: "var(--font-mono)",
                            marginLeft: 4,
                          }}
                        >
                          ({thinkingLabels[lvl]})
                        </span>
                      )}
                    </span>
                    <span style={{ fontSize: scaledChatFont(11), color: "var(--text-dim)", marginLeft: 8 }}>
                      {desc}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {onCompact && (
        <div style={{ position: "relative" }}>
          {compactError && (
            <div
              style={{
                position: "absolute",
                bottom: "calc(100% + 6px)",
                right: 0,
                background: "var(--danger-soft)",
                color: "var(--danger)",
                fontSize: scaledChatFont(11),
                padding: "4px 8px",
                borderRadius: "var(--radius-control)",
                whiteSpace: "nowrap",
                pointerEvents: "none",
                boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
                zIndex: 50,
              }}
            >
              {compactError}
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              closeDropdowns();
              if (isCompacting) onAbortCompaction?.();
              else onCompact();
            }}
            disabled={isStreaming && !isCompacting}
            title={isCompacting ? t("stopCompaction", "Stop compaction") : t("compact", "Compact context")}
            aria-label={isCompacting ? t("stopCompaction", "Stop compaction") : t("compact", "Compact context")}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              minWidth: 32,
              minHeight: 32,
              padding: isMobile ? 0 : "0 9px",
              background: isCompacting ? "color-mix(in srgb, var(--danger) 8%, transparent)" : "transparent",
              border: "none",
              borderRadius: "var(--radius-control)",
              color: isCompacting ? "var(--danger)" : mixWarning(compactUrgency, 100, "var(--text-muted)"),
              cursor: isStreaming && !isCompacting ? "not-allowed" : "pointer",
              fontSize: scaledChatFont(12),
              opacity: isStreaming && !isCompacting ? 0.5 : 1,
              transition: "background 0.12s, color 0.12s",
            }}
            onMouseEnter={(e) => {
              if (isStreaming && !isCompacting) return;
              e.currentTarget.style.background = isCompacting
                ? "color-mix(in srgb, var(--danger) 16%, transparent)"
                : mixWarning(compactUrgency, 24, "var(--bg-hover)");
              e.currentTarget.style.color = isCompacting
                ? "var(--danger)"
                : mixWarning(compactUrgency, 100, "var(--text)");
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = isCompacting
                ? "color-mix(in srgb, var(--danger) 8%, transparent)"
                : "transparent";
              e.currentTarget.style.color = isCompacting
                ? "var(--danger)"
                : mixWarning(compactUrgency, 100, "var(--text-muted)");
            }}
          >
            {isCompacting ? (
              <>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    background: "currentColor",
                    display: "inline-block",
                  }}
                />
                {!isMobile && <span style={{ whiteSpace: "nowrap" }}>{t("compacting", "Compacting…")}</span>}
              </>
            ) : (
              <>
                <CompactIcon size={11} />
                {!isMobile && (
                  <span style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                    {contextPct !== null && contextWindowTokens !== null
                      ? `${contextPct.toFixed(1)}%/${formatTokenCount(contextWindowTokens)} · ${t("compactAction", "Compact")}`
                      : t("compactAction", "Compact")}
                  </span>
                )}
              </>
            )}
          </button>
        </div>
      )}

      {onSoundToggle !== undefined && (
        <button
          type="button"
          aria-pressed={soundEnabled === true}
          onClick={() => {
            closeDropdowns();
            onSoundToggle();
          }}
          title={
            soundEnabled
              ? t("disableCompletionSound", "Disable completion sound")
              : t("enableCompletionSound", "Enable completion sound")
          }
          aria-label={
            soundEnabled
              ? t("disableCompletionSound", "Disable completion sound")
              : t("enableCompletionSound", "Enable completion sound")
          }
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            padding: 0,
            background: "transparent",
            border: "none",
            borderRadius: "var(--radius-control)",
            color: soundEnabled ? "var(--text-muted)" : "var(--text-dim)",
            cursor: "pointer",
            opacity: soundEnabled ? 1 : 0.55,
            transition: "background 0.12s, color 0.12s, opacity 0.12s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--bg-hover)";
            e.currentTarget.style.color = "var(--text)";
            e.currentTarget.style.opacity = "1";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = soundEnabled ? "var(--text-muted)" : "var(--text-dim)";
            e.currentTarget.style.opacity = soundEnabled ? "1" : "0.55";
          }}
        >
          {soundEnabled ? <SpeakerOnIcon size={12} /> : <SpeakerOffIcon size={12} />}
        </button>
      )}
    </div>
  );
}

function CheckDot() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="var(--accent)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
      aria-hidden="true"
    >
      <polyline points="1.5 5 4 7.5 8.5 2.5" />
    </svg>
  );
}
