import { type NoticeItem } from "@/hooks/useAgentSession";
import { useI18n } from "@/i18n";
import { scaledChatFont } from "@/lib/chat-appearance";
import appIconUrl from "../../../../build/icon.png";
import { NoticeShelf } from "./status";
export function Welcome({ notices }: { notices: NoticeItem[] }) {
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
              lineHeight: 1.4,
            }}
          >
            <img
              src={appIconUrl}
              alt=""
              aria-hidden="true"
              style={{
                width: 36,
                height: 36,
                borderRadius: "var(--bui-r-card)",
                objectFit: "contain",
                flexShrink: 0,
                display: "block",
              }}
            />
            <span
              style={{
                fontSize: scaledChatFont(20),
                color: "var(--bui-ink)",
                fontWeight: 600,
                letterSpacing: "-0.2px",
                flexShrink: 0,
                whiteSpace: "nowrap",
              }}
            >
              Dexon
            </span>
          </div>
        </div>
        <div
          className="chat-welcome-line"
          style={
            {
              "--line-i": 1,
              marginTop: 16,
              marginBottom: 12,
              fontSize: scaledChatFont(13),
              lineHeight: 1.6,
              color: "var(--bui-ink-2)",
              textAlign: "center",
            } as React.CSSProperties
          }
        >
          {t("welcomeGreeting", "What are we working on? Describe a task, paste an error, or drop in files.")}
        </div>
        <NoticeShelf notices={notices} align="center" />
      </div>
    </div>
  );
}
