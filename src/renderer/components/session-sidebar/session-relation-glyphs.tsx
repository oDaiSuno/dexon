import type { SessionRelation } from "@shared/session-orchestration";

export function ForkSessionGlyph({ size = 10 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );
}

export function DelegateSessionGlyph({ size = 11 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <path d="M4 4v7a4 4 0 0 0 4 4h8" />
      <polyline points="13 12 16 15 13 18" />
    </svg>
  );
}

export function SessionRelationGlyph({ relation, size }: { relation: SessionRelation; size?: number }) {
  return relation === "delegate" ? <DelegateSessionGlyph size={size} /> : <ForkSessionGlyph size={size} />;
}
