import type { ReactNode } from "react";

export function SshConnectButton({
  children,
  onClick,
  disabled,
  primary,
  enter,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  enter?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={typeof children === "string" ? children : undefined}
      className="type-label-medium"
      disabled={disabled}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        minHeight: 32,
        padding: "6px 10px",
        borderRadius: "var(--radius-control)",
        border: `1px solid ${primary ? "var(--fx-accent-blue-border)" : "var(--fx-line-default)"}`,
        background: primary ? "var(--fx-accent-blue)" : "var(--fx-surface-card)",
        color: primary ? "var(--fx-text-on-accent)" : "var(--fx-text-primary)",
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {children}
      {enter && (
        <span aria-hidden="true" className="type-mono-meta">
          ↵
        </span>
      )}
    </button>
  );
}

export function SshConnectNote({ children }: { children: ReactNode }) {
  return (
    <p className="type-meta-default" style={{ color: "var(--fx-text-secondary)", overflowWrap: "anywhere" }}>
      {children}
    </p>
  );
}
