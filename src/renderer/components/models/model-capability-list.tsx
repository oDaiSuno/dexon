import { useId, type ReactNode } from "react";
import { Toggle } from "../form-controls";
import { BrainIcon, ImageIcon } from "../chat-input/icons";

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
      {children}
    </span>
  );
}

export function ReasoningIcon() {
  return (
    <CapabilityIcon>
      <BrainIcon size={14} strokeWidth={2} />
    </CapabilityIcon>
  );
}

export function ImageInputIcon() {
  return (
    <CapabilityIcon>
      <ImageIcon size={14} strokeWidth={2} />
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
