import { useI18n } from "@/i18n";

export function RightPanelToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { t } = useI18n();
  const label = open ? t("hideFilePanel", "Hide file panel") : t("showFilePanel", "Show file panel");
  return (
    <button
      onClick={onToggle}
      title={label}
      aria-label={label}
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        zIndex: 300,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 36,
        height: 36,
        padding: 0,
        background: "var(--bg-panel)",
        border: "none",
        borderLeft: "1px solid var(--border)",
        borderBottom: "1px solid var(--border)",
        color: open ? "var(--text)" : "var(--text-muted)",
        cursor: "pointer",
        transition: "color 0.12s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = "var(--text)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = open ? "var(--text)" : "var(--text-muted)";
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <line x1="15" y1="3" x2="15" y2="21" />
      </svg>
    </button>
  );
}
