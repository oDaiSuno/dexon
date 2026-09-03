import type { ReactNode } from "react";

/** Shared inline stroke icons for the chat composer cluster. */
export function Icon({
  children,
  size = 15,
  strokeWidth = 1.8,
}: {
  children: ReactNode;
  size?: number;
  strokeWidth?: number;
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
    >
      {children}
    </svg>
  );
}

export function PlusIcon({ size = 16 }: { size?: number }) {
  return (
    <Icon size={size} strokeWidth={2}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}

/** 3D package/box outline — the skill glyph (matches the reference chip). */
export function PackageIcon({ size = 15 }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z" />
      <path d="M12 22V12" />
      <polyline points="3.29 7 12 12 20.71 7" />
      <line x1="7.5" x2="16.5" y1="4.5" y2="9.5" />
    </Icon>
  );
}

export function ImageIcon({ size = 15 }: { size?: number }) {
  return (
    <Icon size={size}>
      <rect x="3" y="3" width="18" height="18" rx="2.5" />
      <circle cx="8.8" cy="8.8" r="1.7" />
      <path d="m21 15.5-4.2-4.2a1.5 1.5 0 0 0-2.1 0L5 21" />
    </Icon>
  );
}

export function PaperclipIcon({ size = 15 }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="m21.4 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </Icon>
  );
}

export function ArrowUpIcon({ size = 16 }: { size?: number }) {
  return (
    <Icon size={size} strokeWidth={2.4}>
      <path d="M12 19V5M5 12l7-7 7 7" />
    </Icon>
  );
}

export function StopIcon({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <rect x="0.75" y="0.75" width="8.5" height="8.5" rx="2" fill="currentColor" />
    </svg>
  );
}

export function FileDocIcon({ size = 12 }: { size?: number }) {
  return (
    <Icon size={size} strokeWidth={2}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </Icon>
  );
}

/** Tight 8×8 viewBox — do NOT reuse the 24×24 Icon base here, the
 *  1–7 line coordinates only fill a small-box canvas correctly. */
export function XIcon({ size = 8, strokeWidth = 1.5 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 8 8"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="1" y1="1" x2="7" y2="7" />
      <line x1="7" y1="1" x2="1" y2="7" />
    </svg>
  );
}

export function LightbulbIcon({ size = 11 }: { size?: number }) {
  return (
    <Icon size={size} strokeWidth={2}>
      <path d="M9.5 2A5.5 5.5 0 0 0 4 7.5c0 1.7.78 3.21 2 4.21V14a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-2.29c1.22-1 2-2.51 2-4.21A5.5 5.5 0 0 0 9.5 2z" />
      <line x1="7" y1="18" x2="12" y2="18" />
      <line x1="8" y1="21" x2="11" y2="21" />
    </Icon>
  );
}

export function SpeakerOnIcon({ size = 12 }: { size?: number }) {
  return (
    <Icon size={size} strokeWidth={2}>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </Icon>
  );
}

export function SpeakerOffIcon({ size = 12 }: { size?: number }) {
  return (
    <Icon size={size} strokeWidth={2}>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="23" y1="9" x2="17" y2="15" />
      <line x1="17" y1="9" x2="23" y2="15" />
    </Icon>
  );
}

export function CompactIcon({ size = 11 }: { size?: number }) {
  return (
    <Icon size={size} strokeWidth={2}>
      <polyline points="4 14 10 14 10 20" />
      <polyline points="20 10 14 10 14 4" />
      <line x1="10" y1="14" x2="3" y2="21" />
      <line x1="21" y1="3" x2="14" y2="10" />
    </Icon>
  );
}

export function CpuIcon({ size = 11 }: { size?: number }) {
  return (
    <Icon size={size} strokeWidth={2}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <line x1="9" y1="1" x2="9" y2="4" />
      <line x1="15" y1="1" x2="15" y2="4" />
      <line x1="9" y1="20" x2="9" y2="23" />
      <line x1="15" y1="20" x2="15" y2="23" />
      <line x1="20" y1="9" x2="23" y2="9" />
      <line x1="20" y1="14" x2="23" y2="14" />
      <line x1="1" y1="9" x2="4" y2="9" />
      <line x1="1" y1="14" x2="4" y2="14" />
    </Icon>
  );
}

export function RetryIcon({ size = 11 }: { size?: number }) {
  return (
    <Icon size={size} strokeWidth={2}>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </Icon>
  );
}

export function RecallIcon({ size = 13 }: { size?: number }) {
  return (
    <Icon size={size} strokeWidth={2}>
      <polyline points="9 14 4 9 9 4" />
      <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
    </Icon>
  );
}

export function CheckIcon({ size = 10 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 10 10"
      fill="none"
      stroke="var(--accent)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
      aria-hidden="true"
    >
      <polyline points="1.5 5 4 7.5 8.5 2.5" />
    </svg>
  );
}

export function ChevronDownIcon({ size = 11 }: { size?: number }) {
  return (
    <Icon size={size} strokeWidth={2.4}>
      <path d="M6 9l6 6 6-6" />
    </Icon>
  );
}
