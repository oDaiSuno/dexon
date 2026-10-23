import { useId, useState, type ReactNode } from "react";

const DUOTONE_FOLDER_OPEN = {
  tone: "M208,88v24H69.77a8,8,0,0,0-7.59,5.47L32,208V64a8,8,0,0,1,8-8H93.33a8,8,0,0,1,4.8,1.6L128,80h72A8,8,0,0,1,208,88Z",
  line: "M245,110.64A16,16,0,0,0,232,104H216V88a16,16,0,0,0-16-16H130.67L102.94,51.2a16.14,16.14,0,0,0-9.6-3.2H40A16,16,0,0,0,24,64V208a8,8,0,0,0,8,8H211.1a8,8,0,0,0,7.59-5.47l28.49-85.47A16.05,16.05,0,0,0,245,110.64ZM93.34,64,123.2,86.4A8,8,0,0,0,128,88h72v16H69.77a16,16,0,0,0-15.18,10.94L40,158.7V64Zm112,136H43.1l26.67-80H232Z",
};

const DUOTONE_FOLDER = {
  tone: "M128,80H32V56a8,8,0,0,1,8-8H92.69a8,8,0,0,1,5.65,2.34Z",
  line: "M216,72H131.31L104,44.69A15.86,15.86,0,0,0,92.69,40H40A16,16,0,0,0,24,56V200.62A15.4,15.4,0,0,0,39.38,216H216.89A15.13,15.13,0,0,0,232,200.89V88A16,16,0,0,0,216,72ZM92.69,56l16,16H40V56ZM216,200H40V88H216Z",
};

function FolderGlyph({ open }: { open: boolean }) {
  const shape = open ? DUOTONE_FOLDER_OPEN : DUOTONE_FOLDER;
  return (
    <svg
      width={17}
      height={17}
      viewBox="0 0 256 256"
      fill="currentColor"
      aria-hidden="true"
      style={{ display: "block", flexShrink: 0, color: "var(--fx-text-secondary)" }}
    >
      <path opacity={0.3} d={shape.tone} />
      <path d={shape.line} />
    </svg>
  );
}

function ChevronGlyph({ open }: { open: boolean }) {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "block", flexShrink: 0, color: "var(--fx-text-tertiary)" }}
    >
      {open ? <path d="m6 9 6 6 6-6" /> : <path d="m9 18 6-6-6-6" />}
    </svg>
  );
}

export function ProjectRow({
  name,
  path,
  count,
  countLabel,
  open,
  current,
  onToggle,
  actions,
}: {
  name: string;
  path: string;
  count: number;
  countLabel: string;
  open: boolean;
  current: boolean;
  onToggle: () => void;
  actions?: (revealed: boolean) => ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const countId = useId();
  const revealed = Boolean(actions) && (hovered || focused);
  return (
    <div
      title={path}
      onMouseEnter={() => setHovered(true)}
      onMouseMove={() => {
        if (!hovered) setHovered(true);
      }}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
      style={{ position: "relative", display: "grid", gridTemplateColumns: "minmax(0, 1fr)", alignItems: "center" }}
    >
      <button
        type="button"
        data-project-row
        aria-label={name}
        aria-describedby={countId}
        aria-expanded={open}
        aria-current={current ? "location" : undefined}
        onClick={onToggle}
        style={{
          gridArea: "1 / 1",
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          width: "100%",
          height: 32,
          padding: "0 10px",
          background: hovered ? "var(--fx-surface-hover)" : "var(--fx-surface-sidebar)",
          border: "none",
          borderRadius: "var(--radius-control)",
          cursor: "pointer",
          textAlign: "left",
          transition: "background var(--duration-quick) var(--ease-smooth-out)",
        }}
      >
        <ChevronGlyph open={open} />
        <FolderGlyph open={open} />
        <span
          className="type-body-large"
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: "var(--fx-text-body)",
          }}
        >
          {name}
        </span>
        <span
          className="type-label-default"
          aria-hidden="true"
          style={{
            flexShrink: 0,
            color: "var(--fx-text-tertiary)",
            opacity: revealed ? 0 : 1,
            transition: "opacity var(--duration-quick) var(--ease-smooth-out)",
          }}
        >
          {count}
        </span>
        <span id={countId} className="sr-only">
          {countLabel}
        </span>
      </button>
      {actions && <div style={{ gridArea: "1 / 1", justifySelf: "end", marginRight: 6 }}>{actions(revealed)}</div>}
    </div>
  );
}
