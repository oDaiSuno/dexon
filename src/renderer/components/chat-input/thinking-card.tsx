import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Icon } from "./icons";
import { CLEAR, HOVER, paint, QUICK } from "./menu-chrome";
import { ThinkingFill, ThinkingThumb, labelTone, tint, type ThinkingLevel } from "./thinking-art";

const EXIT_MS = 120;
const TRACK_WIDTH = 308;
const STOP_WIDTH = 40;
const GLIDE = "var(--duration-spring-glide) var(--ease-spring-glide)";

const CARD: CSSProperties = {
  bottom: "calc(100% + 8px)",
  zIndex: 100,
  transformOrigin: "bottom right",
  gap: 14,
  padding: "calc(var(--space-4) - 1px)",
  borderRadius: "var(--radius-composer)",
  borderWidth: 1,
  borderStyle: "solid",
};
const PLAIN_CARD = {
  "--thinking-card-tint": "var(--fx-surface-raised)",
  "--thinking-card-stop": "50%",
  borderColor: "var(--fx-line-default)",
  boxShadow: `var(--shadow-picker), 0 0 36px 0 ${tint("var(--fx-data-violet)", 0)}`,
} as CSSProperties;
const SPECIAL_CARD: Partial<Record<ThinkingLevel, CSSProperties>> = {
  xhigh: {
    ...PLAIN_CARD,
    "--thinking-card-tint": "var(--fx-data-fuchsia-surface)",
    borderColor: "var(--fx-data-fuchsia-line)",
  } as CSSProperties,
  max: {
    "--thinking-card-tint": "var(--fx-data-purple-surface)",
    "--thinking-card-stop": "35%",
    borderColor: "var(--fx-data-fuchsia-line)",
    boxShadow: `var(--shadow-picker), 0 0 36px 0 ${tint("var(--fx-data-violet)", 20)}`,
  } as CSSProperties,
};
const TRACK: CSSProperties = {
  width: TRACK_WIDTH,
  height: 36,
  borderRadius: "var(--radius-card)",
  transition: `background-color ${GLIDE}`,
};
const STOP: CSSProperties = { width: STOP_WIDTH, height: 36 };
const TICK: CSSProperties = {
  width: 4,
  height: 4,
  borderRadius: 2,
  background: "var(--fx-control-tick)",
  transition: `opacity ${GLIDE}`,
};
const HELP: CSSProperties = { color: "var(--fx-text-secondary)", cursor: "help" };
const AUTO_CHIP: CSSProperties = {
  height: 22,
  padding: "0 var(--space-2)",
  border: "1px solid var(--fx-line-strong)",
  borderRadius: "var(--radius-chip)",
  cursor: "pointer",
  whiteSpace: "nowrap",
  transition: `background ${QUICK}, color ${QUICK}`,
};

export interface ThinkingOption {
  level: ThinkingLevel;
  label: string;
  description: string;
}

export interface ThinkingCardProps {
  label: string;
  title: string;
  help: string;
  fasterLabel: string;
  smarterLabel: string;
  current: ThinkingLevel;
  currentLabel: string;
  description: string;
  options: ThinkingOption[];
  onPick: (level: ThinkingLevel) => void;
}

export function useClosingCard(open: boolean, visible: boolean): boolean {
  const [closing, setClosing] = useState(false);
  const wasOpenRef = useRef(open);
  useLayoutEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = open;
    if (open || !wasOpen || !visible) {
      setClosing(false);
      return;
    }
    setClosing(true);
    const timer = setTimeout(() => setClosing(false), EXIT_MS);
    return () => clearTimeout(timer);
  }, [open, visible]);
  return closing && !open && visible;
}

export function ThinkingCard({ closing = false, ...props }: ThinkingCardProps & { closing?: boolean }) {
  const { label, title, help, fasterLabel, smarterLabel, current, currentLabel, description, options, onPick } = props;
  const auto = options.find((option) => option.level === "auto");
  const stops = options.filter((option) => option.level !== "auto");
  const activeIndex = stops.findIndex((option) => option.level === current);
  const isAuto = current === "auto";
  const resting = isAuto || current === "off";
  const autoRest = isAuto ? "var(--fx-surface-selected)" : CLEAR;
  const headingColor = resting ? "var(--fx-text-tertiary)" : labelTone(current);
  const pitch = (TRACK_WIDTH - STOP_WIDTH) / Math.max(1, stops.length - 1);
  const thumbOffset = Math.max(0, activeIndex) * pitch;
  const fillWidth =
    activeIndex <= 0 || stops[activeIndex]?.level === "off"
      ? "0px"
      : `calc((100% - ${STOP_WIDTH}px) * ${activeIndex / Math.max(1, stops.length - 1)} + 38px)`;
  return (
    <div
      role={closing ? undefined : "menu"}
      aria-label={closing ? undefined : label}
      aria-hidden={closing ? true : undefined}
      inert={closing ? true : undefined}
      className={`${closing ? "thinking-card-closing" : "composer-pop-in"} thinking-card absolute right-0 box-border flex w-[340px] flex-col overflow-hidden`}
      style={{ ...CARD, ...(SPECIAL_CARD[current] ?? PLAIN_CARD) }}
    >
      <div className="flex items-center" style={{ gap: "var(--space-2)" }}>
        <span className="type-body-large" style={{ color: "var(--fx-text-secondary)", whiteSpace: "nowrap" }}>
          {title}
        </span>
        <span className="type-heading thinking-glide" style={{ color: headingColor, whiteSpace: "nowrap" }}>
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
            {stops.map((option, index) => (
              <button
                key={option.level}
                type="button"
                role="menuitemradio"
                aria-checked={index === activeIndex}
                title={option.description}
                onClick={() => onPick(option.level)}
                className="relative flex flex-none cursor-pointer items-center justify-center border-none bg-transparent p-0"
                style={STOP}
              >
                <span className="sr-only">{option.label}</span>
                <span aria-hidden="true" style={{ ...TICK, opacity: index === activeIndex ? 0 : 1 }} />
              </button>
            ))}
            <ThinkingThumb level={current} offset={thumbOffset} />
          </div>
        </div>
      )}
      <span className="type-label-default" style={{ color: "var(--fx-text-tertiary)" }}>
        {description}
      </span>
    </div>
  );
}
