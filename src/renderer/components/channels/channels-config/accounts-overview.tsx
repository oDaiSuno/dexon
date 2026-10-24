import type { ChannelsSnapshot } from "@shared/channel-types";
import { useI18n } from "@/i18n";
import { AccountRow } from "./account-row";
import { AddAppMenu, type AddAppActions } from "./add-app-menu";
import { statusFor } from "./channel-labels";
import { SectionCard, SectionHeader } from "./section-layout";

export function AccountsOverview({
  snapshot,
  loading,
  busy,
  onOpenAccount,
  onReconnect,
  ...addActions
}: {
  snapshot: ChannelsSnapshot;
  loading: boolean;
  busy: boolean;
  onOpenAccount: (accountId: string) => void;
  onReconnect: (accountId: string) => void;
} & AddAppActions) {
  const { t } = useI18n();

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%" }}>
      <SectionHeader
        title={t("messagingChannels", "Chat apps")}
        count={snapshot.accounts.length}
        aside={<AddAppMenu busy={busy} {...addActions} />}
      />
      {loading ? (
        <div className="type-body-default" style={{ color: "var(--fx-text-tertiary)" }}>
          {t("loading", "Loading…")}
        </div>
      ) : snapshot.accounts.length === 0 ? (
        <div
          className="type-body-default"
          style={{
            padding: 28,
            border: "1px dashed var(--fx-line-default)",
            borderRadius: "var(--radius-resource-card)",
            color: "var(--fx-text-tertiary)",
            textAlign: "center",
          }}
        >
          {t(
            "noChannels",
            "No messaging accounts configured. Connect WeChat, Telegram, or Feishu / Lark to get started.",
          )}
        </div>
      ) : (
        <SectionCard>
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {snapshot.accounts.map((account, index) => (
              <AccountRow
                key={account.id}
                account={account}
                status={statusFor(snapshot, account.id)}
                snapshot={snapshot}
                divider={index > 0}
                busy={busy}
                onOpen={() => onOpenAccount(account.id)}
                onReconnect={() => onReconnect(account.id)}
              />
            ))}
          </ul>
        </SectionCard>
      )}
    </section>
  );
}
