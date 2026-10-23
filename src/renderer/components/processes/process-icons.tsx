import type { ReactNode } from "react";

function Glyph({ size, strokeWidth, children }: { size: number; strokeWidth: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function SquareGlyph() {
  return (
    <Glyph size={11} strokeWidth={2.25}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
    </Glyph>
  );
}

export function EllipsisGlyph() {
  return (
    <Glyph size={14} strokeWidth={1.75}>
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </Glyph>
  );
}

export function CircleXGlyph() {
  return (
    <Glyph size={13} strokeWidth={2.25}>
      <circle cx="12" cy="12" r="10" />
      <path d="m15 9-6 6" />
      <path d="m9 9 6 6" />
    </Glyph>
  );
}

export function SquareArrowOutUpRightGlyph() {
  return (
    <Glyph size={10} strokeWidth={2}>
      <path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6" />
      <path d="m21 3-9 9" />
      <path d="M15 3h6v6" />
    </Glyph>
  );
}

export function SquareTerminalGlyph() {
  return (
    <Glyph size={20} strokeWidth={1.75}>
      <path d="m7 11 2-2-2-2" />
      <path d="M11 13h4" />
      <rect width="18" height="18" x="3" y="3" rx="2" />
    </Glyph>
  );
}

export function TriangleAlertGlyph() {
  return (
    <Glyph size={13} strokeWidth={2}>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </Glyph>
  );
}
