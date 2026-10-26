import { useI18n } from "@/i18n";

export function PageTopBar({
  parent,
  current,
  isMobile,
  onParent,
  onBack,
}: {
  parent: string;
  current: string;
  isMobile: boolean;
  onParent?: () => void;
  onBack: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        height: 56,
        padding: isMobile ? "0 var(--space-4)" : "0 var(--space-6)",
        borderBottom: "1px solid var(--fx-line-subtle)",
        background: "var(--fx-surface-main)",
        flexShrink: 0,
      }}
    >
      {onParent ? (
        <button
          type="button"
          onClick={onParent}
          className="type-body-large"
          style={{
            flexShrink: 0,
            padding: 0,
            border: "none",
            borderRadius: "var(--radius-chip)",
            background: "transparent",
            color: "var(--fx-text-secondary)",
            cursor: "pointer",
          }}
        >
          {parent}
        </button>
      ) : (
        <span className="type-body-large" style={{ color: "var(--fx-text-secondary)" }}>
          {parent}
        </span>
      )}
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        style={{ flexShrink: 0, color: "var(--fx-text-tertiary)" }}
      >
        <path d="m9 18 6-6-6-6" />
      </svg>
      <span
        className="type-body-large-medium"
        style={{
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: "var(--fx-text-primary)",
        }}
      >
        {current}
      </span>
      <div style={{ flex: 1 }} />
      <button
        type="button"
        onClick={onBack}
        aria-label={t("backToSession", "Back to session")}
        aria-keyshortcuts="Escape"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          flexShrink: 0,
          padding: 0,
          border: "none",
          borderRadius: "var(--radius-chip)",
          background: "transparent",
          color: "var(--fx-text-tertiary)",
          cursor: "pointer",
        }}
      >
        <kbd
          className="type-mono-meta"
          aria-hidden="true"
          style={{
            display: "flex",
            alignItems: "center",
            padding: "1px 6px",
            border: "1px solid var(--fx-line-strong)",
            borderRadius: "var(--radius-kbd)",
            color: "var(--fx-text-tertiary)",
          }}
        >
          esc
        </kbd>
        <span className="type-body-default" aria-hidden="true" style={{ whiteSpace: "nowrap" }}>
          {t("backToSession", "Back to session")}
        </span>
      </button>
    </div>
  );
}
