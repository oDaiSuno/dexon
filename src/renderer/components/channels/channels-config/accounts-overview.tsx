import type { ChannelsSnapshot } from "@shared/channel-types";
import { call } from "@/lib/api-client";
import { useI18n } from "@/i18n";
import { AccountCard } from "./account-card";
import { updateFeishuCredential, updateTelegramToken } from "./account-credentials";
import { statusFor } from "./channel-labels";

export function AccountsOverview({
  snapshot,
  loading,
  busy,
  run,
  refresh,
}: {
  snapshot: ChannelsSnapshot;
  loading: boolean;
  busy: boolean;
  run: (task: () => Promise<unknown>) => Promise<void>;
  refresh: () => Promise<void>;
}) {
  const { t } = useI18n();
  const configuredCount = snapshot.accounts.filter((account) => account.configured).length;

  return (
    <section>
      <div
        style={{
          fontSize: "var(--text-meta)",
          color: "var(--fx-text-tertiary)",
          textTransform: "uppercase",
          letterSpacing: ".08em",
          marginBottom: 8,
        }}
      >
        {t("channelOverview", "Overview")} · {configuredCount} {t("configuredAccounts", "accounts configured")}
      </div>
      {loading ? (
        <div style={{ color: "var(--fx-text-tertiary)", fontSize: "var(--text-label)" }}>
          {t("loading", "Loading…")}
        </div>
      ) : snapshot.accounts.length === 0 ? (
        <div
          style={{
            border: "1px dashed var(--fx-line-default)",
            borderRadius: "var(--radius-card)",
            padding: 28,
            textAlign: "center",
            color: "var(--fx-text-tertiary)",
            fontSize: "var(--text-label)",
          }}
        >
          {t(
            "noChannels",
            "No messaging accounts configured. Connect WeChat, Telegram, or Feishu / Lark to get started.",
          )}
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {snapshot.accounts.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              status={statusFor(snapshot, account.id)}
              busy={busy}
              onSave={(next) => run(() => call("channels.accountUpsert", { account: next }))}
              onStart={() => run(() => call("channels.start", { accountId: account.id }))}
              onStop={() => run(() => call("channels.stop", { accountId: account.id }))}
              onRestart={() => run(() => call("channels.restart", { accountId: account.id }))}
              onProbe={() => call("channels.probe", { accountId: account.id })}
              onUpdateToken={(token) => updateTelegramToken(account, token)}
              onUpdateFeishuCredential={async (nextAccount, appSecret) => {
                const probe = await updateFeishuCredential(account, nextAccount, appSecret, t);
                await refresh();
                return probe;
              }}
              onTestSend={(peerId, message) =>
                run(() => call("channels.testSend", { accountId: account.id, peerId, message }))
              }
              onDelete={() => {
                if (window.confirm(t("deleteChannelConfirm", "Delete this messaging account and its bindings?"))) {
                  void run(() => call("channels.accountDelete", { accountId: account.id }));
                }
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}
