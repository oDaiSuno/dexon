import type { CSSProperties } from "react";
import { Icon } from "./icons";

export const HOVER_OVERLAY = "var(--fx-surface-hover-overlay)";
export const HOVER_OVERLAY_STRONG = "var(--fx-surface-hover-overlay-strong)";
export const SURFACE_SIDEBAR = "var(--fx-surface-sidebar)";
export const SURFACE_INSET = "var(--fx-surface-inset)";
export const SURFACE_RAISED = "var(--fx-surface-raised)";

export const CARD_WIDTH = 600;
export const PROJECTS_PANE_WIDTH = 216;
export const OUTLINE_NONE: CSSProperties = { outline: "none" };

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
  gap: 8,
  height: 28,
  flexShrink: 0,
  padding: "0 8px",
  color: "var(--fx-text-tertiary)",
};

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
