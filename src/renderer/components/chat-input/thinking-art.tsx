import type { CSSProperties } from "react";

export const THINKING_LEVELS = ["auto", "off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export const THINKING_TONES: Record<ThinkingLevel, string> = {
  auto: "var(--fx-text-secondary)",
  off: "var(--fx-text-secondary)",
  minimal: "var(--fx-data-slate)",
  low: "var(--fx-data-blue)",
  medium: "var(--fx-data-indigo)",
  high: "var(--fx-data-violet)",
  xhigh: "var(--fx-data-fuchsia)",
  max: "var(--fx-data-fuchsia)",
};

const THINKING_FILL: Record<Exclude<ThinkingLevel, "max">, [number, number]> = {
  auto: [3, 30],
  off: [3, 30],
  minimal: [3, 36],
  low: [3, 42],
  medium: [3, 55],
  high: [6, 54],
  xhigh: [6, 60],
};

const HALO_LEVELS = new Set<ThinkingLevel>(["high", "xhigh", "max"]);

export const labelTone = (level: ThinkingLevel) => (level === "max" ? "var(--fx-data-cyan)" : THINKING_TONES[level]);

export const tint = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

const MIDPOINT = 0.55;

function fillStops(level: ThinkingLevel): CSSProperties {
  if (level === "max") {
    return {
      "--thinking-fill-a": tint("var(--fx-data-indigo)", 55),
      "--thinking-fill-b": tint("var(--fx-data-violet)", 65),
      "--thinking-fill-c": tint("var(--fx-data-fuchsia)", 75),
    } as CSSProperties;
  }
  const [from, to] = THINKING_FILL[level];
  const tone = THINKING_TONES[level];
  return {
    "--thinking-fill-a": tint(tone, from),
    "--thinking-fill-b": tint(tone, Math.round(from + (to - from) * MIDPOINT)),
    "--thinking-fill-c": tint(tone, to),
  } as CSSProperties;
}

export function ThinkingFill({ level, width }: { level: ThinkingLevel; width: string }) {
  return (
    <span aria-hidden="true" className="thinking-fill" style={{ ...fillStops(level), width }}>
      <span className="thinking-layer" data-on={level === "xhigh" || level === "max"}>
        <span className="thinking-pixels thinking-pixels-a" />
      </span>
      <span className="thinking-layer" data-on={level === "max"}>
        <span className="thinking-pixels thinking-pixels-b" />
        <span className="thinking-burst" />
      </span>
    </span>
  );
}

export function ThinkingThumb({ level, offset }: { level: ThinkingLevel; offset: number }) {
  return (
    <span
      aria-hidden="true"
      className="thinking-thumb"
      style={{
        transform: `translateX(${offset}px)`,
        color: THINKING_TONES[level],
        opacity: level === "auto" ? 0 : 1,
      }}
    >
      <span className="thinking-layer" data-on={HALO_LEVELS.has(level)}>
        <span className="thinking-halo" />
      </span>
      <BrainThumb alpha={level === "off" || level === "auto" ? 0 : 0.45} />
    </span>
  );
}

function BrainThumb({ alpha }: { alpha: number }) {
  return (
    <svg
      width={30}
      height={30}
      viewBox="0 0 256 256"
      fill="currentColor"
      aria-hidden="true"
      style={{ position: "relative" }}
    >
      <path
        className="thinking-brain-fill"
        opacity={alpha}
        d="M240,124a48,48,0,0,1-32,45.27V176a40,40,0,0,1-80,0,40,40,0,0,1-80,0v-6.73a48,48,0,0,1,0-90.54V72a40,40,0,0,1,80,0,40,40,0,0,1,80,0v6.73A48,48,0,0,1,240,124Z"
      />
      <path d="M248,124a56.11,56.11,0,0,0-32-50.61V72a48,48,0,0,0-88-26.49A48,48,0,0,0,40,72v1.39a56,56,0,0,0,0,101.2V176a48,48,0,0,0,88,26.49A48,48,0,0,0,216,176v-1.41A56.09,56.09,0,0,0,248,124ZM88,208a32,32,0,0,1-31.81-28.56A55.87,55.87,0,0,0,64,180h8a8,8,0,0,0,0-16H64A40,40,0,0,1,50.67,86.27,8,8,0,0,0,56,78.73V72a32,32,0,0,1,64,0v68.26A47.8,47.8,0,0,0,88,128a8,8,0,0,0,0,16,32,32,0,0,1,0,64Zm104-44h-8a8,8,0,0,0,0,16h8a55.87,55.87,0,0,0,7.81-.56A32,32,0,1,1,168,144a8,8,0,0,0,0-16,47.8,47.8,0,0,0-32,12.26V72a32,32,0,0,1,64,0v6.73a8,8,0,0,0,5.33,7.54A40,40,0,0,1,192,164Zm16-52a8,8,0,0,1-8,8h-4a36,36,0,0,1-36-36V80a8,8,0,0,1,16,0v4a20,20,0,0,0,20,20h4A8,8,0,0,1,208,112ZM60,120H56a8,8,0,0,1,0-16h4A20,20,0,0,0,80,84V80a8,8,0,0,1,16,0v4A36,36,0,0,1,60,120Z" />
    </svg>
  );
}
