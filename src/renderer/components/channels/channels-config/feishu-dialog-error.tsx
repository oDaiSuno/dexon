export function FeishuDialogError({ error }: { error: string }) {
  if (!error) return null;
  return (
    <div
      role="alert"
      data-testid="feishu-connect-error"
      style={{
        marginTop: 12,
        color: "var(--fx-status-danger)",
        fontSize: "var(--text-meta)",
        lineHeight: 1.5,
        overflowWrap: "anywhere",
      }}
    >
      {error}
    </div>
  );
}
