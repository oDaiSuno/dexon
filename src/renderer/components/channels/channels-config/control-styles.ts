export function buttonStyle(primary = false): React.CSSProperties {
  return {
    border: `1px solid ${primary ? "var(--fx-accent-blue)" : "var(--fx-line-default)"}`,
    borderRadius: "var(--radius-control)",
    background: primary ? "var(--fx-accent-blue)" : "var(--fx-surface-main)",
    color: primary ? "var(--fx-text-on-accent)" : "var(--fx-text-secondary)",
    minHeight: 36,
    padding: "0 12px",
    cursor: "pointer",
  };
}

export const inputStyle: React.CSSProperties = {
  width: "100%",
  border: "1px solid var(--fx-line-default)",
  borderRadius: "var(--radius-control)",
  background: "var(--fx-surface-main)",
  color: "var(--fx-text-primary)",
  minHeight: 36,
  padding: "8px 8px",
};

export const controlTextClass = "type-body-default";
