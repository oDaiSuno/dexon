import { useI18n } from "@/i18n";
import type { SessionCopyFeedback, SessionCopyField } from "./use-session-info";

export interface SessionIdentityProps {
  sessionName?: string;
  sessionFile?: string;
  sessionId: string;
  copyFeedback: SessionCopyFeedback | null;
  onCopyField: (field: SessionCopyField, value: string) => void;
}

export function SessionIdentity({
  sessionName,
  sessionFile,
  sessionId,
  copyFeedback,
  onCopyField,
}: SessionIdentityProps) {
  const { t } = useI18n();

  const rows = [
    ...(sessionName ? [{ label: t("sessionName", "Name"), value: sessionName, copyField: null }] : []),
    {
      label: t("sessionFile", "File"),
      value: sessionFile ?? t("inMemory", "In-memory"),
      copyField: "file" as const,
    },
    { label: t("sessionId", "ID"), value: sessionId, copyField: "id" as const },
  ];

  const copyButton = (field: SessionCopyField, value: string) => {
    const feedback = copyFeedback?.field === field ? copyFeedback.status : null;
    const copied = feedback === "copied";
    const failed = feedback === "error";
    const defaultLabel = field === "file" ? t("copyFilePath", "Copy file path") : t("copySessionId", "Copy session ID");
    const label = copied ? t("copied", "Copied") : failed ? t("copyFailed", "Copy failed") : defaultLabel;
    return (
      <button
        type="button"
        title={label}
        aria-label={label}
        onClick={() => onCopyField(field, value)}
        style={{
          alignSelf: "start",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 22,
          height: 22,
          marginTop: -2,
          color: failed ? "var(--fx-status-danger)" : copied ? "var(--fx-accent-blue)" : "var(--fx-text-tertiary)",
          background: "transparent",
          border: "1px solid var(--fx-line-default)",
          borderRadius: "var(--radius-chip)",
          cursor: "pointer",
          flex: "0 0 auto",
          transition: "color 0.12s, border-color 0.12s, background 0.12s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "var(--fx-accent-blue)";
          e.currentTarget.style.borderColor = "var(--fx-accent-blue)";
          e.currentTarget.style.background = "var(--bg-hover)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = failed
            ? "var(--fx-status-danger)"
            : copied
              ? "var(--fx-accent-blue)"
              : "var(--fx-text-tertiary)";
          e.currentTarget.style.borderColor = "var(--fx-line-default)";
          e.currentTarget.style.background = "transparent";
        }}
      >
        {failed ? (
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <line x1="12" y1="7" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12" y2="17" />
          </svg>
        ) : copied ? (
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </button>
    );
  };

  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontSize: "var(--text-label)",
          fontWeight: 700,
          color: "var(--fx-text-primary)",
          marginBottom: 8,
        }}
      >
        {t("sessionInfo", "Session info")}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto minmax(0, 1fr) auto",
          columnGap: 12,
          rowGap: 8,
          alignItems: "start",
        }}
      >
        {rows.map((row) => (
          <div key={`session-info:${row.label}`} style={{ display: "contents" }}>
            <div style={{ color: "var(--fx-text-tertiary)", whiteSpace: "nowrap" }}>{row.label}</div>
            <div
              style={{
                color: "var(--fx-text-secondary)",
                minWidth: 0,
                overflowWrap: "anywhere",
                wordBreak: "break-word",
                whiteSpace: "normal",
              }}
            >
              {row.value}
            </div>
            <div>{row.copyField ? copyButton(row.copyField, row.value) : null}</div>
          </div>
        ))}
      </div>
      {copyFeedback?.status === "error" && (
        <div role="alert" style={{ marginTop: 8, color: "var(--fx-status-danger)" }}>
          {t("copyFailed", "Copy failed")}. {t("checkClipboardPermission", "Check clipboard permission and retry.")}
        </div>
      )}
    </div>
  );
}
