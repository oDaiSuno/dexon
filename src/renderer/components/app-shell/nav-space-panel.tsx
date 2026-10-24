import { useI18n } from "@/i18n";
import { NavSpacePicker, type SpaceChoice } from "../app-nav/nav-space-picker";

export interface SpaceNotice {
  message: string;
  reason?: string;
  onRetry?: () => void;
}

export function NavSpacePanel({
  notice,
  pickerOpen,
  spaces,
  onSelectSpace,
  onClosePicker,
}: {
  notice: SpaceNotice | null;
  pickerOpen: boolean;
  spaces: SpaceChoice[];
  onSelectSpace: (path: string) => void;
  onClosePicker: () => void;
}) {
  const { t } = useI18n();
  if (!notice && !pickerOpen) return null;

  return (
    <div style={{ position: "relative", padding: "0 10px 8px", flexShrink: 0 }}>
      <NavSpacePicker open={pickerOpen} spaces={spaces} onSelect={onSelectSpace} onClose={onClosePicker} />
      {notice && (
        <div
          role="alert"
          className="type-label-default"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            padding: "8px 10px",
            border: "1px solid var(--fx-status-danger-border)",
            borderRadius: "var(--radius-card)",
            background: "var(--fx-status-danger-soft)",
            color: "var(--fx-text-primary)",
          }}
        >
          <span>{notice.message}</span>
          {notice.reason && (
            <span className="type-meta-default" style={{ color: "var(--fx-text-secondary)", overflowWrap: "anywhere" }}>
              {notice.reason}
            </span>
          )}
          {notice.onRetry && (
            <button
              type="button"
              onClick={notice.onRetry}
              className="type-label-default"
              style={{
                alignSelf: "flex-start",
                height: 24,
                padding: "0 10px",
                background: "var(--fx-surface-raised)",
                border: "1px solid var(--fx-line-default)",
                borderRadius: "var(--radius-control)",
                color: "var(--fx-text-primary)",
                cursor: "pointer",
              }}
            >
              {t("retry", "Retry")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
