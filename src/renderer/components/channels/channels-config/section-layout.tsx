import type { ReactNode } from "react";

export function SectionHeader({ title, count, aside }: { title: string; count?: ReactNode; aside?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", minHeight: 32 }}>
      <h2 className="type-title-dialog" style={{ margin: 0, color: "var(--fx-text-primary)" }}>
        {title}
      </h2>
      <span className="type-body-default" style={{ flex: 1, minWidth: 0, color: "var(--fx-text-tertiary)" }}>
        {count}
      </span>
      {aside}
    </div>
  );
}

export function SectionCard({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        width: "100%",
        border: "1px solid var(--fx-line-default)",
        borderRadius: "var(--radius-resource-card)",
        background: "var(--fx-surface-raised)",
        overflow: "clip",
      }}
    >
      {children}
    </div>
  );
}

export function EmptyLine({ children }: { children: ReactNode }) {
  return (
    <div className="type-body-default" style={{ color: "var(--fx-text-tertiary)", padding: "14px 16px" }}>
      {children}
    </div>
  );
}
