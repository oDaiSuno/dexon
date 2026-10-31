import type { RefObject } from "react";
import { CLEAR, QUICK } from "./menu-chrome";

export const READ_ONLY_WIDTH = 460;

export const CARD_ABOVE_TRIGGER = "calc(100% + 8px)";

export const FOOTER_BUTTON = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  height: 26,
  padding: "0 8px",
  border: "none",
  borderRadius: "var(--radius-chip)",
  background: CLEAR,
  cursor: "pointer",
  outline: "none",
  transition: `background ${QUICK}`,
} as const;

export interface CardHeight {
  maxHeight: number;
}

export function cardHeight(anchorRef: RefObject<HTMLButtonElement | null>): CardHeight {
  const rect = anchorRef.current?.getBoundingClientRect();
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  const top = rect && rect.top > 0 ? rect.top : Math.round(viewportHeight * 0.75);
  return { maxHeight: Math.max(220, top - 72) };
}
