import { useState } from "react";
import type { ChannelsSnapshot } from "@shared/channel-types";
import { call } from "@/lib/api-client";
import { AccountDetailHost } from "./channels-config/account-detail-host";
import { AccountsOverview } from "./channels-config/accounts-overview";
import { ActivitySection } from "./channels-config/activity-section";
import { BindingsSection } from "./channels-config/bindings-section";
import { ChannelsHeader } from "./channels-config/channels-header";
import { FeishuCredentialDialog } from "./channels-config/feishu-credential-dialog";
import { LoginDialog } from "./channels-config/login-dialog";
import { PairingSection } from "./channels-config/pairing-section";
import { RelayHero } from "./channels-config/relay-hero";
import { TelegramTokenDialog } from "./channels-config/telegram-token-dialog";
import { useChannelsState } from "./channels-config/use-channels-state";

export { AccountCard } from "./channels-config/account-card";
export { AccountDetail } from "./channels-config/account-detail";
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
  const [openAccountId, setOpenAccountId] = useState<string | null>(null);
  const openAccount = snapshot.accounts.find((account) => account.id === openAccountId);

  return (
    <div style={{ width: "100%", overflowY: "auto", padding: "var(--space-8) var(--space-6)" }}>
      <div
        style={{
          maxWidth: 760,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
          gap: "var(--space-8)",
        }}
      >
        <ChannelsHeader />

        {error && (
          <div
            role="alert"
            className="type-body-default"
            style={{
              border: "1px solid var(--fx-status-danger-border)",
              background: "var(--fx-status-danger-soft)",
              color: "var(--fx-status-danger)",
              borderRadius: "var(--radius-pairing-card)",
              padding: "12px 16px",
            }}
          >
            {error}
          </div>
        )}

        <RelayHero snapshot={snapshot} />
        <PairingSection snapshot={snapshot} busy={busy} run={run} />
        <AccountsOverview
          snapshot={snapshot}
          loading={loading}
          busy={busy}
          onOpenAccount={setOpenAccountId}
          onReconnect={(accountId) => void run(() => call("channels.restart", { accountId }))}
          onConnectWeixin={() => void beginLogin()}
          onConnectTelegram={() => {
            setTelegramError("");
            setTelegramDialogOpen(true);
          }}
          onConnectFeishu={() => {
            setFeishuError("");
            setFeishuDialogOpen(true);
          }}
        />
        <BindingsSection snapshot={snapshot} sessions={sessions} busy={busy} run={run} />
        <ActivitySection snapshot={snapshot} />
      </div>

      {openAccount && (
        <AccountDetailHost
          account={openAccount}
          snapshot={snapshot}
          busy={busy}
          run={run}
          refresh={refresh}
          onClose={() => setOpenAccountId(null)}
        />
      )}
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
