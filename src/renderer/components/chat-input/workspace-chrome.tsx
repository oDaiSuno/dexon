import type { CSSProperties } from "react";
import { Icon } from "./icons";
import { QUICK } from "./menu-chrome";

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
