import { type NoticeItem } from "@/hooks/useAgentSession";
import { useI18n } from "@/i18n";
import appIconUrl from "../../../../build/icon.png";
import { NoticeShelf } from "./status";
export function Welcome({
  notices,
  onDismissNotice,
}: {
  notices: NoticeItem[];
  onDismissNotice: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="relative z-[1] flex min-h-0 flex-[1_1_0] flex-col items-center justify-end overflow-y-auto px-4 pb-5">
      <div className="chat-content-column flex flex-col items-center">
        <div className="chat-welcome-line" style={{ "--line-i": 0 } as React.CSSProperties}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
            }}
          >
            <img
              src={appIconUrl}
              alt=""
              aria-hidden="true"
              style={{
                width: 36,
                height: 36,
                borderRadius: "var(--radius-card)",
                objectFit: "contain",
                flexShrink: 0,
                display: "block",
              }}
            />
            <span
              className="type-title-section"
              style={{
                color: "var(--fx-text-primary)",
                flexShrink: 0,
                whiteSpace: "nowrap",
              }}
            >
              Dexon
            </span>
          </div>
        </div>
        <div
          className="chat-welcome-line type-body-relaxed"
          style={
            {
              "--line-i": 1,
              marginTop: 16,
              marginBottom: 12,
              color: "var(--fx-text-secondary)",
              textAlign: "center",
            } as React.CSSProperties
          }
        >
          {t("welcomeGreeting", "What are we working on? Describe a task, paste an error, or drop in files.")}
        </div>
        <NoticeShelf notices={notices} onDismiss={onDismissNotice} align="center" />
      </div>
    </div>
  );
}
