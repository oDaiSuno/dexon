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

export function ArrowLeftRightIcon({ size = 14 }: { size?: number }) {
  return (
    <StrokeIcon size={size} weight={1.75}>
      <path d="M8 3 4 7l4 4" />
      <path d="M4 7h16" />
      <path d="m16 21 4-4-4-4" />
      <path d="M20 17H4" />
    </StrokeIcon>
  );
}

export function MessageSquareIcon() {
  return (
    <StrokeIcon size={14} weight={1.75}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </StrokeIcon>
  );
}

export function MessageSquareDashedIcon() {
  return (
    <StrokeIcon size={14} weight={1.75}>
      <path d="M10 17H7l-4 4v-7" />
      <path d="M14 17h1" />
      <path d="M14 3h1" />
      <path d="M19 3a2 2 0 0 1 2 2" />
      <path d="M21 14v1a2 2 0 0 1-2 2" />
      <path d="M21 9v1" />
      <path d="M3 9v1" />
      <path d="M5 3a2 2 0 0 0-2 2" />
      <path d="M9 3h1" />
    </StrokeIcon>
  );
}

export function UsersIcon() {
  return (
    <StrokeIcon size={15} weight={1.75}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </StrokeIcon>
  );
}

export function EllipsisIcon() {
  return (
    <StrokeIcon size={16} weight={2}>
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </StrokeIcon>
  );
}

export function MenuTrashIcon() {
  return (
    <StrokeIcon size={15} weight={1.75}>
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </StrokeIcon>
  );
}

export function CheckIcon() {
  return (
    <StrokeIcon size={14} weight={2}>
      <path d="M20 6 9 17l-5-5" />
    </StrokeIcon>
  );
}

export function ArrowDownLeftIcon() {
  return (
    <StrokeIcon size={13} weight={2}>
      <path d="M17 7 7 17" />
      <path d="M17 17H7V7" />
    </StrokeIcon>
  );
}

export function ArrowUpRightIcon() {
  return (
    <StrokeIcon size={13} weight={2}>
      <path d="M7 7h10v10" />
      <path d="M7 17 17 7" />
    </StrokeIcon>
  );
}

export function TriangleAlertIcon() {
  return (
    <StrokeIcon size={13} weight={2}>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </StrokeIcon>
  );
}

export function BanIcon() {
  return (
    <StrokeIcon size={13} weight={2}>
      <circle cx="12" cy="12" r="10" />
      <path d="m4.9 4.9 14.2 14.2" />
    </StrokeIcon>
  );
}
