import { useEffect, useState, type ReactNode } from "react";
import type {
  ChannelAccountConfig,
  ChannelAccountView,
  ChannelProbeResult,
  ChannelStatus,
} from "@shared/channel-types";
import { useI18n } from "@/i18n";
import { AccountActions, AccountFooter, confirmSave } from "./account-actions";
import { AccountCardHeader } from "./account-card-header";
import { FeishuCredentialFields, TelegramCredentialFields } from "./account-credential-fields";
import { ProbeFeedbackNotice, TestSendRow, type ProbeFeedback } from "./account-feedback";
import { AccountSettingsGrid } from "./account-settings-grid";

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <h3 className="type-body-large-medium" style={{ margin: 0, color: "var(--fx-text-primary)" }}>
        {title}
      </h3>
      {children}
    </section>
  );
}

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
  onClose = () => undefined,
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
  onClose?: () => void;
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

  const reportFailure = (cause: unknown) =>
    setProbeFeedback({ ok: false, message: cause instanceof Error ? cause.message : String(cause), at: Date.now() });

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
      reportFailure(cause);
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
      reportFailure(cause);
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
      reportFailure(cause);
    } finally {
      setUpdatingToken(false);
    }
  };

  return (
    <>
      <div
        data-testid="channel-account-detail"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 24,
          padding: 20,
        }}
      >
        <DetailSection title={t("channelDetailConnection", "Connection")}>
          <AccountCardHeader account={account} status={status} draft={draft} setDraft={setDraft} />
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
            onStart={onStart}
            onStop={onStop}
            onRestart={onRestart}
            onProbe={handleProbe}
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
        </DetailSection>
        <DetailSection title={t("channelDetailAccess", "Access & permissions")}>
          <AccountSettingsGrid draft={draft} setDraft={setDraft} />
        </DetailSection>
      </div>
      <AccountFooter
        busy={busy}
        onDelete={onDelete}
        onCancel={onClose}
        onSave={() => {
          if (confirmSave(draft, t)) onSave(draft);
        }}
      />
    </>
  );
}
