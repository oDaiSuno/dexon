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

const THINKING_FILL: Partial<Record<ThinkingLevel, number[]>> = {
  minimal: [3, 36],
  low: [3, 42],
  medium: [3, 55],
  high: [6, 54],
  xhigh: [6, 60],
};

const HALO_LEVELS = new Set<ThinkingLevel>(["high", "xhigh", "max"]);

export const labelTone = (level: ThinkingLevel) => (level === "max" ? "var(--fx-data-cyan)" : THINKING_TONES[level]);

export const tint = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

function thinkingFill(level: ThinkingLevel): string {
  if (level === "max") {
    return `linear-gradient(90deg, ${tint("var(--fx-data-indigo)", 55)} 0%, ${tint("var(--fx-data-violet)", 65)} 55%, ${tint("var(--fx-data-fuchsia)", 75)} 100%)`;
  }
  const [from, to] = THINKING_FILL[level] ?? [0, 0];
  return `linear-gradient(90deg, ${tint(THINKING_TONES[level], from)} 0%, ${tint(THINKING_TONES[level], to)} 100%)`;
}

const FILL: CSSProperties = {
  position: "absolute",
  inset: "0 auto 0 0",
  overflow: "hidden",
  borderRadius: "var(--radius-card)",
  transition: "width var(--duration-glide, 220ms) var(--ease-smooth-out, ease)",
  pointerEvents: "none",
};

const HALO: CSSProperties = {
  position: "absolute",
  left: 5,
  top: 3,
  width: 30,
  height: 30,
  borderRadius: 15,
  opacity: 0.5,
  filter: "blur(6px)",
  pointerEvents: "none",
};

export function ThinkingFill({ level, width }: { level: ThinkingLevel; width: string }) {
  const sparkles = level === "xhigh" || level === "max";
  return (
    <span aria-hidden="true" style={{ ...FILL, width, background: thinkingFill(level) }}>
      {sparkles && <span className="thinking-pixels thinking-pixels-a" />}
      {level === "max" && <span className="thinking-pixels thinking-pixels-b" />}
      {level === "max" && <span className="thinking-burst" />}
    </span>
  );
}

export function ThinkingThumb({ level }: { level: ThinkingLevel }) {
  return (
    <>
      {HALO_LEVELS.has(level) && (
        <span aria-hidden="true" className="thinking-halo" style={{ ...HALO, background: THINKING_TONES[level] }} />
      )}
      <BrainThumb alpha={level === "off" ? 0 : 0.45} />
    </>
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
        opacity={alpha}
        d="M240,124a48,48,0,0,1-32,45.27V176a40,40,0,0,1-80,0,40,40,0,0,1-80,0v-6.73a48,48,0,0,1,0-90.54V72a40,40,0,0,1,80,0,40,40,0,0,1,80,0v6.73A48,48,0,0,1,240,124Z"
      />
      <path d="M248,124a56.11,56.11,0,0,0-32-50.61V72a48,48,0,0,0-88-26.49A48,48,0,0,0,40,72v1.39a56,56,0,0,0,0,101.2V176a48,48,0,0,0,88,26.49A48,48,0,0,0,216,176v-1.41A56.09,56.09,0,0,0,248,124ZM88,208a32,32,0,0,1-31.81-28.56A55.87,55.87,0,0,0,64,180h8a8,8,0,0,0,0-16H64A40,40,0,0,1,50.67,86.27,8,8,0,0,0,56,78.73V72a32,32,0,0,1,64,0v68.26A47.8,47.8,0,0,0,88,128a8,8,0,0,0,0,16,32,32,0,0,1,0,64Zm104-44h-8a8,8,0,0,0,0,16h8a55.87,55.87,0,0,0,7.81-.56A32,32,0,1,1,168,144a8,8,0,0,0,0-16,47.8,47.8,0,0,0-32,12.26V72a32,32,0,0,1,64,0v6.73a8,8,0,0,0,5.33,7.54A40,40,0,0,1,192,164Zm16-52a8,8,0,0,1-8,8h-4a36,36,0,0,1-36-36V80a8,8,0,0,1,16,0v4a20,20,0,0,0,20,20h4A8,8,0,0,1,208,112ZM60,120H56a8,8,0,0,1,0-16h4A20,20,0,0,0,80,84V80a8,8,0,0,1,16,0v4A36,36,0,0,1,60,120Z" />
    </svg>
  );
}
