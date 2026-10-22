import type { ChannelsSnapshot } from "@shared/channel-types";
import { call } from "@/lib/api-client";
import { AccountsOverview } from "./channels-config/accounts-overview";
import { ActivitySection } from "./channels-config/activity-section";
import { BindingsSection } from "./channels-config/bindings-section";
import { ChannelsHeader } from "./channels-config/channels-header";
import { FeishuCredentialDialog } from "./channels-config/feishu-credential-dialog";
import { LoginDialog } from "./channels-config/login-dialog";
import { PairingSection } from "./channels-config/pairing-section";
import { TelegramTokenDialog } from "./channels-config/telegram-token-dialog";
import { useChannelsState } from "./channels-config/use-channels-state";

export { AccountCard } from "./channels-config/account-card";
export { FEISHU_PERMISSION_IMPORT_JSON } from "./channels-config/constants";
export { FeishuCredentialDialog } from "./channels-config/feishu-credential-dialog";
export { LoginDialog } from "./channels-config/login-dialog";
export { TelegramTokenDialog } from "./channels-config/telegram-token-dialog";

export function ChannelsConfig({ onSnapshotChange }: { onSnapshotChange?: (snapshot: ChannelsSnapshot) => void }) {
  const {
    snapshot,
    sessions,
    loading,
    busy,
    error,
    login,
    setLogin,
    verificationCode,
    setVerificationCode,
    telegramDialogOpen,
    setTelegramDialogOpen,
    telegramError,
    setTelegramError,
    feishuDialogOpen,
    setFeishuDialogOpen,
    feishuError,
    setFeishuError,
    feishuScanDomain,
    refresh,
    run,
    beginLogin,
    beginFeishuLogin,
    connectTelegram,
    connectFeishu,
    closeLogin,
  } = useChannelsState(onSnapshotChange);

  return (
    <div style={{ width: "100%", overflowY: "auto", padding: "24px clamp(16px, 4vw, 36px)" }}>
      <div style={{ maxWidth: 820, margin: "0 auto" }}>
        <ChannelsHeader
          busy={busy}
          onConnectFeishu={() => {
            setFeishuError("");
            setFeishuDialogOpen(true);
          }}
          onConnectTelegram={() => {
            setTelegramError("");
            setTelegramDialogOpen(true);
          }}
          onConnectWeixin={beginLogin}
        />

        {error && (
          <div
            style={{
              marginTop: 16,
              border: "1px solid var(--fx-status-danger-border)",
              background: "var(--fx-status-danger-soft)",
              color: "var(--fx-status-danger)",
              borderRadius: "var(--radius-card)",
              padding: 12,
              fontSize: "var(--text-label)",
            }}
          >
            {error}
          </div>
        )}

        <AccountsOverview snapshot={snapshot} loading={loading} busy={busy} run={run} refresh={refresh} />

        <PairingSection snapshot={snapshot} busy={busy} run={run} />
        <BindingsSection snapshot={snapshot} sessions={sessions} busy={busy} run={run} />
        <ActivitySection snapshot={snapshot} />
      </div>

      {login && (
        <LoginDialog
          event={login}
          code={verificationCode}
          setCode={setVerificationCode}
          onSubmitCode={() =>
            run(async () => {
              await call("channels.loginSubmitCode", {
                channel: login.channel,
                sessionKey: login.sessionKey,
                code: verificationCode,
              });
              setVerificationCode("");
              setLogin({ ...login, phase: "waiting", message: "正在验证…" });
            })
          }
          onRetry={() => {
            if (login.channel === "feishu") void beginFeishuLogin(feishuScanDomain);
            else void beginLogin();
          }}
          onClose={closeLogin}
        />
      )}
      {telegramDialogOpen && (
        <TelegramTokenDialog
          busy={busy}
          error={telegramError}
          onConnect={(token) => void connectTelegram(token)}
          onClose={() => setTelegramDialogOpen(false)}
        />
      )}
      {feishuDialogOpen && (
        <FeishuCredentialDialog
          busy={busy}
          error={feishuError}
          onStartScan={(domain) => void beginFeishuLogin(domain)}
          onConnect={(appId, appSecret, domain) => void connectFeishu(appId, appSecret, domain)}
          onClose={() => setFeishuDialogOpen(false)}
        />
      )}
    </div>
  );
}
