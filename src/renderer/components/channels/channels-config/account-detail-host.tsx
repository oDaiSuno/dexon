import type { ChannelAccountView, ChannelsSnapshot } from "@shared/channel-types";
import { call } from "@/lib/api-client";
import { useI18n } from "@/i18n";
import { AccountDetail } from "./account-detail";
import { updateFeishuCredential, updateTelegramToken } from "./account-credentials";
import { statusFor } from "./channel-labels";

export function AccountDetailHost({
  account,
  snapshot,
  busy,
  run,
  refresh,
  onClose,
}: {
  account: ChannelAccountView;
  snapshot: ChannelsSnapshot;
  busy: boolean;
  run: (task: () => Promise<unknown>) => Promise<void>;
  refresh: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <AccountDetail
      account={account}
      status={statusFor(snapshot, account.id)}
      busy={busy}
      onClose={onClose}
      onSave={(next) =>
        void run(async () => {
          await call("channels.accountUpsert", { account: next });
          onClose();
        })
      }
      onStart={() => void run(() => call("channels.start", { accountId: account.id }))}
      onStop={() => void run(() => call("channels.stop", { accountId: account.id }))}
      onRestart={() => void run(() => call("channels.restart", { accountId: account.id }))}
      onProbe={() => call("channels.probe", { accountId: account.id })}
      onUpdateToken={(token) => updateTelegramToken(account, token)}
      onUpdateFeishuCredential={async (nextAccount, appSecret) => {
        const probe = await updateFeishuCredential(account, nextAccount, appSecret, t);
        await refresh();
        return probe;
      }}
      onTestSend={(peerId, message) =>
        void run(() => call("channels.testSend", { accountId: account.id, peerId, message }))
      }
      onDelete={() => {
        if (window.confirm(t("deleteChannelConfirm", "Delete this messaging account and its bindings?"))) {
          onClose();
          void run(() => call("channels.accountDelete", { accountId: account.id }));
        }
      }}
    />
  );
}
