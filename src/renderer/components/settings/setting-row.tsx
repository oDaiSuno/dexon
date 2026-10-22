export const selectStyle: React.CSSProperties = {
  width: "auto",
  minWidth: 160,
};

export const selectClassName = "ui-select";

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
        minHeight: 56,
        padding: "12px 4px",
        borderTop: "1px solid var(--border)",
      }}
    >
      <label
        htmlFor={controlId}
        style={{
          fontSize: "var(--text-body-lg)",
          fontWeight: "var(--weight-medium)",
          color: "var(--text)",
          cursor: "pointer",
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}
