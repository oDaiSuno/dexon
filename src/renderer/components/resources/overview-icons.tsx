import type { ReactNode } from "react";

function OverviewIcon({
  size,
  strokeWidth = 1.75,
  className,
  children,
}: {
  size: number;
  strokeWidth?: number;
  className?: string;
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
      className={className ? `shrink-0 ${className}` : "shrink-0"}
    >
      {children}
    </svg>
  );
}

type IconProps = { size: number; className?: string };

export function PlusIcon({ size, className }: IconProps) {
  return (
    <OverviewIcon size={size} strokeWidth={2} className={className}>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </OverviewIcon>
  );
}

export function InfoIcon({ size, className }: IconProps) {
  return (
    <OverviewIcon size={size} strokeWidth={2} className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </OverviewIcon>
  );
}

export function TriangleAlertIcon({ size, className }: IconProps) {
  return (
    <OverviewIcon size={size} className={className}>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </OverviewIcon>
  );
}

export function SkillIcon({ size, className }: IconProps) {
  return (
    <OverviewIcon size={size} className={className}>
      <path d="M12 7v14" />
      <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
    </OverviewIcon>
  );
}

export function SparklesIcon({ size, className }: IconProps) {
  return (
    <OverviewIcon size={size} className={className}>
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
      <path d="M20 3v4" />
      <path d="M22 5h-4" />
    </OverviewIcon>
  );
}

export function PuzzleIcon({ size, className }: IconProps) {
  return (
    <OverviewIcon size={size} className={className}>
      <path d="M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z" />
    </OverviewIcon>
  );
}

export function PackageIcon({ size, className }: IconProps) {
  return (
    <OverviewIcon size={size} className={className}>
      <path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z" />
      <path d="M12 22V12" />
      <path d="m3.3 7 7.703 4.734a2 2 0 0 0 1.994 0L20.7 7" />
      <path d="m7.5 4.27 9 5.15" />
    </OverviewIcon>
  );
}

export function ChevronRightIcon({ size, className }: IconProps) {
  return (
    <OverviewIcon size={size} strokeWidth={2} className={className}>
      <path d="m9 18 6-6-6-6" />
    </OverviewIcon>
  );
}

export function ChevronLeftIcon({ size, className }: IconProps) {
  return (
    <OverviewIcon size={size} strokeWidth={2} className={className}>
      <path d="m15 18-6-6 6-6" />
    </OverviewIcon>
  );
}

export function ArrowRightIcon({ size, className }: IconProps) {
  return (
    <OverviewIcon size={size} strokeWidth={2} className={className}>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </OverviewIcon>
  );
}

export function EyeOffIcon({ size, className }: IconProps) {
  return (
    <OverviewIcon size={size} strokeWidth={2} className={className}>
      <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
      <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
      <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
      <path d="m2 2 20 20" />
    </OverviewIcon>
  );
}

export function SmartphoneIcon({ size, className }: IconProps) {
  return (
    <OverviewIcon size={size} className={className}>
      <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
      <path d="M12 18h.01" />
    </OverviewIcon>
  );
}

export function SlashIcon({ size, className }: IconProps) {
  return (
    <OverviewIcon size={size} className={className}>
      <path d="M22 2 2 22" />
    </OverviewIcon>
  );
}
