export const selectStyle: React.CSSProperties = {
  minWidth: 160,
  minHeight: 36,
  padding: "8px 32px 8px 12px",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-control)",
  background: "var(--bg)",
  color: "var(--text)",
  fontSize: "var(--text-body)",
  cursor: "pointer",
};

export function SettingRow({
  label,
  controlId,
  children,
}: {
  label: string;
  controlId: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 20,
        minHeight: 52,
        padding: "12px 12px",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-card)",
        background: "var(--bg-panel)",
      }}
    >
      <label
        htmlFor={controlId}
        style={{ fontSize: "var(--text-body)", color: "var(--text-muted)", cursor: "pointer" }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}
