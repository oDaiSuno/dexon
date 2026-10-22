import { useEffect, useState } from "react";
import type {
  ChannelAccountConfig,
  ChannelAccountView,
  ChannelProbeResult,
  ChannelStatus,
} from "@shared/channel-types";
import { useI18n } from "@/i18n";
import { AccountActions } from "./account-actions";
import { AccountCardHeader } from "./account-card-header";
import { FeishuCredentialFields, TelegramCredentialFields } from "./account-credential-fields";
import { ProbeFeedbackNotice, TestSendRow, type ProbeFeedback } from "./account-feedback";
import { AccountSettingsGrid } from "./account-settings-grid";

export function AccountCard({
  account,
  status,
  busy,
  onSave,
  onStart,
  onStop,
  onRestart,
  onProbe,
  onUpdateToken,
  onUpdateFeishuCredential,
  onTestSend,
  onDelete,
}: {
  account: ChannelAccountView;
  status?: ChannelStatus;
  busy: boolean;
  onSave: (account: ChannelAccountConfig) => void;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  onProbe: () => Promise<ChannelProbeResult>;
  onUpdateToken: (token: string) => Promise<ChannelProbeResult>;
  onUpdateFeishuCredential: (account: ChannelAccountConfig, appSecret: string) => Promise<ChannelProbeResult>;
  onTestSend: (peerId: string, message: string) => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<ChannelAccountConfig>(account);
  const [testPeer, setTestPeer] = useState("");
  const [testMessage, setTestMessage] = useState(() => t("channelTestMessage", "Dexon channel test"));
  const [probing, setProbing] = useState(false);
  const [telegramToken, setTelegramToken] = useState("");
  const [feishuAppSecret, setFeishuAppSecret] = useState("");
  const [updatingToken, setUpdatingToken] = useState(false);
  const [probeFeedback, setProbeFeedback] = useState<ProbeFeedback | null>(null);
  useEffect(() => setDraft(account), [account]);
  useEffect(() => {
    if (!probeFeedback) return;
    const timer = setTimeout(() => setProbeFeedback(null), 8_000);
    return () => clearTimeout(timer);
  }, [probeFeedback]);

  const handleProbe = async () => {
    setProbing(true);
    setProbeFeedback(null);
    try {
      const result = await onProbe();
      setProbeFeedback({
        ok: result.ok,
        message: result.ok ? t("connectionHealthy", "Connection is healthy") : result.message,
        at: Date.now(),
      });
    } catch (cause) {
      setProbeFeedback({
        ok: false,
        message: cause instanceof Error ? cause.message : String(cause),
        at: Date.now(),
      });
    } finally {
      setProbing(false);
    }
  };

  const handleTokenUpdate = async () => {
    const token = telegramToken.trim();
    if (!token) return;
    setUpdatingToken(true);
    setProbeFeedback(null);
    try {
      const result = await onUpdateToken(token);
      setTelegramToken("");
      setProbeFeedback({ ok: result.ok, message: result.message, at: Date.now() });
    } catch (cause) {
      setProbeFeedback({ ok: false, message: cause instanceof Error ? cause.message : String(cause), at: Date.now() });
    } finally {
      setUpdatingToken(false);
    }
  };

  const handleFeishuCredentialUpdate = async () => {
    const appId = draft.appId?.trim();
    const appSecret = feishuAppSecret.trim();
    if (!appId || !appSecret) return;
    setUpdatingToken(true);
    setProbeFeedback(null);
    try {
      const result = await onUpdateFeishuCredential(
        { ...draft, appId, domain: draft.domain === "lark" ? "lark" : "feishu" },
        appSecret,
      );
      setFeishuAppSecret("");
      setProbeFeedback({ ok: result.ok, message: result.message, at: Date.now() });
    } catch (cause) {
      setProbeFeedback({ ok: false, message: cause instanceof Error ? cause.message : String(cause), at: Date.now() });
    } finally {
      setUpdatingToken(false);
    }
  };

  return (
    <div
      style={{
        border: "1px solid var(--fx-line-default)",
        borderRadius: "var(--radius-card)",
        background: "var(--fx-surface-raised)",
        padding: 16,
      }}
    >
      <AccountCardHeader account={account} status={status} draft={draft} setDraft={setDraft} />

      {status?.lastError && (
        <div style={{ color: "var(--fx-status-danger)", fontSize: "var(--text-meta)", marginTop: 12 }}>
          {status.lastError}
        </div>
      )}

      <AccountSettingsGrid draft={draft} setDraft={setDraft} />

      {account.channel === "telegram" && (
        <TelegramCredentialFields
          busy={busy}
          updatingToken={updatingToken}
          telegramToken={telegramToken}
          setTelegramToken={setTelegramToken}
          onUpdate={handleTokenUpdate}
        />
      )}

      {account.channel === "feishu" && (
        <FeishuCredentialFields
          busy={busy}
          updatingToken={updatingToken}
          draft={draft}
          setDraft={setDraft}
          feishuAppSecret={feishuAppSecret}
          setFeishuAppSecret={setFeishuAppSecret}
          onUpdate={handleFeishuCredentialUpdate}
        />
      )}

      <AccountActions
        draft={draft}
        status={status}
        busy={busy}
        probing={probing}
        onSave={onSave}
        onStart={onStart}
        onStop={onStop}
        onRestart={onRestart}
        onProbe={handleProbe}
        onDelete={onDelete}
      />

      {probeFeedback && <ProbeFeedbackNotice feedback={probeFeedback} />}

      <TestSendRow
        account={account}
        busy={busy}
        testPeer={testPeer}
        setTestPeer={setTestPeer}
        testMessage={testMessage}
        setTestMessage={setTestMessage}
        onTestSend={onTestSend}
      />
    </div>
  );
}
