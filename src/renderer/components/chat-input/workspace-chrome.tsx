import type { CSSProperties, MouseEvent } from "react";
import { Icon } from "./icons";

export const QUICK = "var(--duration-quick, 150ms) var(--ease-smooth-out, ease)";
export const HOVER = "var(--fx-surface-hover-overlay)";
export const CLEAR = "var(--fx-surface-hover-clear)";
export const SELECTED = "var(--fx-surface-selected)";

export const ELLIPSIS: CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  minWidth: 0,
};

export const GLYPH: CSSProperties = { display: "flex", flexShrink: 0 };

export const SECTION: CSSProperties = {
  display: "flex",
  alignItems: "center",
  height: 28,
  flexShrink: 0,
  padding: "0 8px",
  color: "var(--fx-text-tertiary)",
};

export const ROW: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  height: 32,
  flexShrink: 0,
  boxSizing: "border-box",
  padding: "0 8px",
  border: "none",
  borderRadius: "var(--radius-control)",
  cursor: "pointer",
  textAlign: "left",
  transition: QUICK,
};

export const SEPARATOR: CSSProperties = { height: 1, flexShrink: 0, background: SELECTED };

export const HOVER_ROW = {
  onMouseEnter: (event: MouseEvent<HTMLElement>) => {
    event.currentTarget.style.background = HOVER;
  },
  onMouseLeave: (event: MouseEvent<HTMLElement>) => {
    event.currentTarget.style.background = CLEAR;
  },
};

export const FOLDER_PATH =
  "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z";

export function CheckMark({ size = 14 }: { size?: number }) {
  return (
    <span style={{ ...GLYPH, color: "var(--fx-accent-blue-text)" }}>
      <Icon size={size} strokeWidth={2}>
        <path d="M20 6 9 17l-5-5" />
      </Icon>
    </span>
  );
}

export function GitBranchGlyph({ size = 15 }: { size?: number }) {
  return (
    <Icon size={size} strokeWidth={1.75}>
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </Icon>
  );
}
