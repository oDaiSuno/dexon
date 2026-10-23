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

type SizedGlyphProps = { size?: number; strokeWidth?: number };

export function GlobeGlyph({ size = 14, strokeWidth = 2 }: SizedGlyphProps) {
  return (
    <Glyph size={size} strokeWidth={strokeWidth}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <path d="M2 12h20" />
    </Glyph>
  );
}

export function RotateCcwGlyph({ size = 14, strokeWidth = 2 }: SizedGlyphProps) {
  return (
    <Glyph size={size} strokeWidth={strokeWidth}>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </Glyph>
  );
}

export function StopGlyph({ size = 14, strokeWidth = 2 }: SizedGlyphProps) {
  return (
    <Glyph size={size} strokeWidth={strokeWidth}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
    </Glyph>
  );
}

export function OctagonXGlyph({ size = 14, strokeWidth = 2 }: SizedGlyphProps) {
  return (
    <Glyph size={size} strokeWidth={strokeWidth}>
      <path d="m15 9-6 6" />
      <path d="M2.586 16.726A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2h6.624a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586z" />
      <path d="m9 9 6 6" />
    </Glyph>
  );
}

export function DownloadGlyph({ size = 14, strokeWidth = 2 }: SizedGlyphProps) {
  return (
    <Glyph size={size} strokeWidth={strokeWidth}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5" />
      <path d="M12 15V3" />
    </Glyph>
  );
}

export function XGlyph({ size = 14, strokeWidth = 2 }: SizedGlyphProps) {
  return (
    <Glyph size={size} strokeWidth={strokeWidth}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Glyph>
  );
}

export function WifiGlyph({ size = 13, strokeWidth = 2 }: SizedGlyphProps) {
  return (
    <Glyph size={size} strokeWidth={strokeWidth}>
      <path d="M12 20h.01" />
      <path d="M2 8.82a15 15 0 0 1 20 0" />
      <path d="M5 12.859a10 10 0 0 1 14 0" />
      <path d="M8.5 16.429a5 5 0 0 1 7 0" />
    </Glyph>
  );
}

export function SearchGlyph({ size = 12, strokeWidth = 2 }: SizedGlyphProps) {
  return (
    <Glyph size={size} strokeWidth={strokeWidth}>
      <path d="m21 21-4.34-4.34" />
      <circle cx="11" cy="11" r="8" />
    </Glyph>
  );
}

export function CopyGlyph({ size = 13, strokeWidth = 1.75 }: SizedGlyphProps) {
  return (
    <Glyph size={size} strokeWidth={strokeWidth}>
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </Glyph>
  );
}

export function ArrowRightGlyph({ size = 13, strokeWidth = 2 }: SizedGlyphProps) {
  return (
    <Glyph size={size} strokeWidth={strokeWidth}>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </Glyph>
  );
}
