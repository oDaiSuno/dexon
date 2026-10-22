import type { ReactNode } from "react";
import type { SessionRelation } from "@shared/session-orchestration";

export function RowIcon({
  size,
  strokeWidth = 1.75,
  children,
}: {
  size: number;
  strokeWidth?: number;
  children: ReactNode;
}) {
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
      style={{ display: "block", flexShrink: 0 }}
    >
      {children}
    </svg>
  );
}

export function SessionMessageGlyph({ size = 14 }: { size?: number }) {
  return (
    <RowIcon size={size}>
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
      <path d="M8 12h.01" />
      <path d="M12 12h.01" />
      <path d="M16 12h.01" />
    </RowIcon>
  );
}

export function BranchCountGlyph({ size = 11 }: { size?: number }) {
  return (
    <RowIcon size={size} strokeWidth={2}>
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </RowIcon>
  );
}

export function ForkSessionGlyph({ size = 14 }: { size?: number }) {
  return (
    <RowIcon size={size}>
      <circle cx="12" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <circle cx="18" cy="6" r="3" />
      <path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9" />
      <path d="M12 12v3" />
    </RowIcon>
  );
}

export function DelegateSessionGlyph({ size = 14 }: { size?: number }) {
  return (
    <RowIcon size={size}>
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <path d="M15 13v2" />
      <path d="M9 13v2" />
    </RowIcon>
  );
}

export function SessionRelationGlyph({ relation, size }: { relation: SessionRelation; size?: number }) {
  return relation === "delegate" ? <DelegateSessionGlyph size={size} /> : <ForkSessionGlyph size={size} />;
}
