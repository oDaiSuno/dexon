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
  action,
  notes,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  notes?: React.ReactNode;
  children: React.ReactNode;
}) {
  const heading = (
    <h2 className="type-body-medium" style={{ flex: 1, minWidth: 0, margin: 0, color: "var(--fx-text-secondary)" }}>
      {title}
    </h2>
  );
  return (
    <section style={{ display: "grid", gap: 10 }}>
      {action ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {heading}
          {action}
        </div>
      ) : (
        heading
      )}
      <div
        style={{
          display: "grid",
          background: "var(--fx-surface-raised)",
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
  divider = true,
  children,
}: {
  label: string;
  description?: string;
  controlId: string;
  divider?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className="ui-setting-row"
      data-divider={divider || undefined}
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

export function SettingValue({ children }: { children: React.ReactNode }) {
  return (
    <span className="type-mono-body" style={{ minWidth: 0, color: "var(--fx-text-secondary)" }}>
      {children}
    </span>
  );
}
