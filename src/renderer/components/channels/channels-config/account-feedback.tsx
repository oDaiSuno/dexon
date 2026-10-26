import type { ChannelAccountView } from "@shared/channel-types";
import { useI18n } from "@/i18n";
import { Button, Field, TextInput } from "../../form-controls";

export type ProbeFeedback = { ok: boolean; message: string; at: number };

export function ProbeFeedbackNotice({ feedback }: { feedback: ProbeFeedback }) {
  const { language } = useI18n();
  return (
    <div
      role="status"
      data-testid="channel-probe-feedback"
      className="type-body-default"
      style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 6,
          height: 6,
          flexShrink: 0,
          borderRadius: 3,
          background: feedback.ok ? "var(--fx-status-success)" : "var(--fx-status-danger)",
        }}
      />
      <span
        style={{
          minWidth: 0,
          color: feedback.ok ? "var(--fx-text-secondary)" : "var(--fx-status-danger)",
          overflowWrap: "anywhere",
        }}
      >
        {feedback.message} · {new Date(feedback.at).toLocaleTimeString(language)}
      </span>
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
  const peerLabel =
    account.channel === "telegram"
      ? t("testSendTelegramChatId", "Telegram chat ID for test-send")
      : account.channel === "feishu"
        ? t("testSendFeishuReceiveId", "Feishu open_id or chat_id for test-send")
        : t("testSendUserId", "User ID for test-send");
  return (
    <Field label={t("testSend", "Test send")} labelSize="body">
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.4fr) auto", gap: 8 }}>
        <TextInput mono value={testPeer} onChange={setTestPeer} placeholder={peerLabel} />
        <TextInput value={testMessage} onChange={setTestMessage} />
        <Button
          disabled={busy || !testPeer.trim() || !testMessage.trim()}
          onClick={() => onTestSend(testPeer.trim(), testMessage.trim())}
        >
          {t("testSend", "Test send")}
        </Button>
      </div>
    </Field>
  );
}
