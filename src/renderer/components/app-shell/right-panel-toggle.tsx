import { useI18n } from "@/i18n";

export function RightPanelToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { t } = useI18n();
  const label = open ? t("hideFilePanel", "Hide file panel") : t("showFilePanel", "Show file panel");
  return (
    <button onClick={onToggle} title={label} aria-label={label} className="right-panel-toggle" data-open={open}>
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect width="18" height="18" x="3" y="3" rx="2" />
        <path d="M15 3v18" />
      </svg>
    </button>
  );
}
