import { useId, type ReactNode } from "react";
import { Toggle } from "../form-controls";

export interface ModelCapability {
  key: string;
  icon: ReactNode;
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function CapabilityIcon({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        width: 28,
        height: 28,
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "var(--radius-row)",
        background: "var(--fx-surface-card)",
        color: "var(--fx-text-secondary)",
      }}
    >
      <svg
        aria-hidden="true"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
    </span>
  );
}

export function ReasoningIcon() {
  return (
    <CapabilityIcon>
      <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
      <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
      <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
      <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
      <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
      <path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
      <path d="M19.938 10.5a4 4 0 0 1 .585.396" />
      <path d="M6 18a4 4 0 0 1-1.967-.516" />
      <path d="M19.967 17.484A4 4 0 0 1 18 18" />
    </CapabilityIcon>
  );
}

export function ImageInputIcon() {
  return (
    <CapabilityIcon>
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </CapabilityIcon>
  );
}

function CapabilityRow({ capability, divided }: { capability: ModelCapability; divided: boolean }) {
  const id = useId();
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        width: "100%",
        padding: "11px 14px",
        boxSizing: "border-box",
        borderTop: divided ? "1px solid var(--fx-line-subtle)" : undefined,
        cursor: "pointer",
      }}
    >
      {capability.icon}
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
        <span id={`${id}-title`} className="type-body-medium" style={{ color: "var(--fx-text-primary)" }}>
          {capability.title}
        </span>
        <span id={`${id}-description`} className="type-label-default" style={{ color: "var(--fx-text-tertiary)" }}>
          {capability.description}
        </span>
      </span>
      <Toggle
        checked={capability.checked}
        onChange={(event) => capability.onChange(event.target.checked)}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
      />
    </label>
  );
}

export function ModelCapabilityList({ label, capabilities }: { label: string; capabilities: ModelCapability[] }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span id={id} className="type-label-default" style={{ color: "var(--fx-text-secondary)" }}>
        {label}
      </span>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          border: "1px solid var(--fx-line-default)",
          borderRadius: "var(--radius-card)",
          background: "var(--fx-surface-raised)",
          overflow: "hidden",
        }}
      >
        {capabilities.map((capability, index) => (
          <CapabilityRow key={capability.key} capability={capability} divided={index > 0} />
        ))}
      </div>
    </div>
  );
}
