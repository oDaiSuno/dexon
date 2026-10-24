import type { ReactNode } from "react";

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gap: 4, color: "var(--fx-text-tertiary)", fontSize: "var(--text-label)" }}>
      <span>{label}</span>
      {children}
    </div>
  );
}

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

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        border: "1px solid var(--fx-line-default)",
        borderRadius: "var(--radius-resource-card)",
        background: "var(--fx-surface-raised)",
        padding: "12px 16px",
      }}
    >
      <div style={{ fontSize: "var(--text-label)", fontWeight: 700, color: "var(--fx-text-primary)", marginBottom: 4 }}>
        {title}
      </div>
      {children}
    </section>
  );
}

export function EmptyLine({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ color: "var(--fx-text-tertiary)", fontSize: "var(--text-meta)", padding: "8px 0" }}>{children}</div>
  );
}
