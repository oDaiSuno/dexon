export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gap: 4, color: "var(--fx-text-tertiary)", fontSize: "var(--text-label)" }}>
      <span>{label}</span>
      {children}
    </div>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        border: "1px solid var(--fx-line-default)",
        borderRadius: "var(--radius-card)",
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
