import type { ChannelAccountView } from "@shared/channel-types";
import { useI18n } from "@/i18n";
import { buttonStyle, inputStyle } from "./control-styles";

export type ProbeFeedback = { ok: boolean; message: string; at: number };

export function ProbeFeedbackNotice({ feedback }: { feedback: ProbeFeedback }) {
  const { language } = useI18n();
  return (
    <div
      role="status"
      data-testid="channel-probe-feedback"
      style={{
        marginTop: 8,
        padding: "8px 8px",
        border: `1px solid ${feedback.ok ? "var(--fx-status-success-border)" : "var(--fx-status-danger-border)"}`,
        borderRadius: "var(--radius-control)",
        background: feedback.ok ? "var(--fx-status-success-soft)" : "var(--fx-status-danger-soft)",
        color: feedback.ok ? "var(--fx-status-success)" : "var(--fx-status-danger)",
        fontSize: "var(--text-meta)",
      }}
    >
      {feedback.ok ? "✓" : "!"} {feedback.message} · {new Date(feedback.at).toLocaleTimeString(language)}
    </div>
  );
}

export function TestSendRow({
  account,
  busy,
  testPeer,
  setTestPeer,
  testMessage,
  setTestMessage,
  onTestSend,
}: {
  account: ChannelAccountView;
  busy: boolean;
  testPeer: string;
  setTestPeer: (value: string) => void;
  testMessage: string;
  setTestMessage: (value: string) => void;
  onTestSend: (peerId: string, message: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(150px,1fr) minmax(220px,2fr) auto",
        gap: 8,
        marginTop: 12,
      }}
    >
      <input
        style={inputStyle}
        value={testPeer}
        onChange={(event) => setTestPeer(event.target.value)}
        placeholder={
          account.channel === "telegram"
            ? t("testSendTelegramChatId", "Telegram chat ID for test-send")
            : account.channel === "feishu"
              ? t("testSendFeishuReceiveId", "Feishu open_id or chat_id for test-send")
              : t("testSendUserId", "User ID for test-send")
        }
      />
      <input style={inputStyle} value={testMessage} onChange={(event) => setTestMessage(event.target.value)} />
      <button
        type="button"
        disabled={busy || !testPeer.trim() || !testMessage.trim()}
        style={buttonStyle()}
        onClick={() => onTestSend(testPeer.trim(), testMessage.trim())}
      >
        {t("testSend", "Test send")}
      </button>
    </div>
  );
}
