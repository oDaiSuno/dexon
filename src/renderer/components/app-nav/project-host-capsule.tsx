import type { ConnectionPresentation } from "@/lib/connection-presentation";
import { useConnectionLabel } from "@/lib/connection-labels";

export function ServerGlyph() {
  return (
    <svg
      data-project-glyph="server"
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0, color: "var(--fx-text-tertiary)" }}
    >
      <rect x="3" y="3" width="18" height="7" rx="2" />
      <rect x="3" y="14" width="18" height="7" rx="2" />
      <path d="M7 6.5h.01M7 17.5h.01" />
    </svg>
  );
}

export function ProjectHostCapsule({
  label,
  connection,
  id,
}: {
  label: string;
  connection: ConnectionPresentation;
  id?: string;
}) {
  const status = useConnectionLabel(connection);
  return (
    <span
      id={id}
      className="project-host-capsule type-mono-meta"
      data-project-host
      data-tone={connection.tone}
      title={`${label} · ${status}`}
      aria-label={`${label} · ${status}`}
    >
      <span className="project-host-dot" aria-hidden="true" />
      <span className="project-host-label">{label}</span>
    </span>
  );
}
