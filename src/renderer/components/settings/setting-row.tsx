export const selectStyle: React.CSSProperties = {
  width: "auto",
  minWidth: 160,
};

export const selectClassName = "ui-select";

export const toggleHitAreaStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  margin: "-8px 0",
  display: "grid",
  placeItems: "center",
  flexShrink: 0,
};

export function SettingGroup({
  title,
  notes,
  children,
}: {
  title: string;
  notes?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section style={{ display: "grid", gap: 10 }}>
      <h2 className="type-body-medium" style={{ margin: 0, color: "var(--fx-text-secondary)" }}>
        {title}
      </h2>
      <div
        style={{
          display: "grid",
          gap: 1,
          background: "var(--fx-line-default)",
          border: "1px solid var(--fx-line-default)",
          borderRadius: "var(--radius-dialog)",
          overflow: "hidden",
        }}
      >
        {children}
      </div>
      {notes}
    </section>
  );
}

export function SettingNote({ alert = false, children }: { alert?: boolean; children: React.ReactNode }) {
  return (
    <p
      role={alert ? "alert" : undefined}
      className="type-label-default"
      style={{ margin: 0, color: alert ? "var(--fx-status-danger)" : "var(--fx-text-tertiary)" }}
    >
      {children}
    </p>
  );
}

export function SettingRow({
  label,
  description,
  controlId,
  children,
}: {
  label: string;
  description?: string;
  controlId: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--space-5)",
        padding: "var(--space-4) var(--space-5)",
        background: "var(--fx-surface-raised)",
      }}
    >
      <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 3 }}>
        <label
          htmlFor={controlId}
          className="type-body-large-medium"
          style={{ color: "var(--fx-text-primary)", cursor: "pointer" }}
        >
          {label}
        </label>
        {description && (
          <p className="type-body-relaxed" style={{ margin: 0, color: "var(--fx-text-tertiary)", textWrap: "pretty" }}>
            {description}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}
