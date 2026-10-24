import type { ReactNode } from "react";

function StrokeIcon({ size, weight, children }: { size: number; weight: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={weight}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      {children}
    </svg>
  );
}

export function SmartphoneIcon() {
  return (
    <StrokeIcon size={22} weight={1.6}>
      <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
      <path d="M12 18h.01" />
    </StrokeIcon>
  );
}

export function PlusIcon() {
  return (
    <StrokeIcon size={14} weight={2}>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </StrokeIcon>
  );
}

export function RefreshIcon() {
  return (
    <StrokeIcon size={14} weight={2}>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </StrokeIcon>
  );
}

export function ChevronRightIcon() {
  return (
    <StrokeIcon size={15} weight={2}>
      <path d="m9 18 6-6-6-6" />
    </StrokeIcon>
  );
}

export function TrashIcon() {
  return (
    <StrokeIcon size={14} weight={2}>
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </StrokeIcon>
  );
}

export function PlugIcon() {
  return (
    <StrokeIcon size={14} weight={2}>
      <path d="M12 22v-5" />
      <path d="M9 8V2" />
      <path d="M15 8V2" />
      <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
    </StrokeIcon>
  );
}
