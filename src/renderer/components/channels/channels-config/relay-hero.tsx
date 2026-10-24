import type { ChannelId, ChannelsSnapshot } from "@shared/channel-types";
import { useI18n } from "@/i18n";
import appIconUrl from "../../../../../build/icon.png";
import { ChannelBrandMark } from "../channel-brand-mark";
import { statusFor } from "./channel-labels";
import { accountPresence, conversationCount, conversationsLabel } from "./channel-presentation";

const RELAY_CHANNELS: ChannelId[] = ["weixin", "telegram", "feishu"];

function relayChannels(snapshot: ChannelsSnapshot): ChannelId[] {
  const configured = new Set(snapshot.accounts.map((account) => account.channel));
  return configured.size === 0 ? RELAY_CHANNELS : RELAY_CHANNELS.filter((channel) => configured.has(channel));
}

function Dot({ color }: { color: string }) {
  return <span aria-hidden="true" style={{ width: 6, height: 6, flexShrink: 0, borderRadius: 3, background: color }} />;
}

function Summary({ snapshot }: { snapshot: ChannelsSnapshot }) {
  const { t } = useI18n();
  const appCount = new Set(snapshot.bindings.map((binding) => binding.accountId)).size;
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: 14,
        padding: 28,
      }}
    >
      <span className="type-meta-caps" style={{ color: "var(--fx-text-tertiary)", textTransform: "uppercase" }}>
        {t("channelOverview", "Connected")}
      </span>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
        <span className="type-title-stat" style={{ color: "var(--fx-text-primary)" }}>
          {snapshot.bindings.length}
        </span>
        <span className="type-body-default" style={{ color: "var(--fx-text-secondary)" }}>
          {t("channelHeroFromApps", "conversations · from {count} chat apps").replace("{count}", String(appCount))}
        </span>
      </div>
      {snapshot.accounts.length > 0 && (
        <ul style={{ display: "flex", flexDirection: "column", gap: 8, margin: 0, padding: 0, listStyle: "none" }}>
          {snapshot.accounts.map((account) => {
            const presence = accountPresence(statusFor(snapshot, account.id), t);
            return (
              <li key={account.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <ChannelBrandMark channel={account.channel} size={16} />
                <span className="type-label-medium" style={{ color: "var(--fx-text-primary)" }}>
                  {account.name}
                </span>
                <span className="type-mono-meta" style={{ flex: 1, minWidth: 0, color: "var(--fx-text-tertiary)" }}>
                  {conversationsLabel(conversationCount(snapshot, account.id), t)}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Dot
                    color={
                      presence.online
                        ? "var(--fx-status-success)"
                        : presence.offline
                          ? "var(--fx-status-warning)"
                          : "var(--fx-text-tertiary)"
                    }
                  />
                  <span className="type-label-default" style={{ color: "var(--fx-text-secondary)" }}>
                    {presence.label}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Relay({ snapshot }: { snapshot: ChannelsSnapshot }) {
  const { t } = useI18n();
  const channels = relayChannels(snapshot);
  const live = snapshot.statuses.some((status) => status.connected);
  const busHeight = Math.max(0, channels.length * 40 + (channels.length - 1) * 14 - 40);
  return (
    <div
      aria-hidden="true"
      style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "28px 36px 28px 8px" }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {channels.map((channel) => (
          <ChannelBrandMark key={channel} channel={channel} size={40} />
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 14 }}>
        {channels.map((channel) => (
          <div key={channel} style={{ display: "flex", alignItems: "center", height: 40 }}>
            <span style={{ width: 36, height: 1, borderTop: "1px dashed var(--fx-line-strong)" }} />
          </div>
        ))}
      </div>
      <span style={{ width: 1, height: busHeight, background: "var(--fx-line-strong)" }} />
      <div style={{ display: "flex", alignItems: "center" }}>
        <span style={{ width: 28, height: 1, background: "var(--fx-line-strong)" }} />
        <Dot color={live ? "var(--fx-status-success)" : "var(--fx-text-tertiary)"} />
        <span style={{ width: 20, height: 1, background: "var(--fx-line-strong)" }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
        <img
          src={appIconUrl}
          alt=""
          style={{ width: 64, height: 64, objectFit: "cover", borderRadius: "var(--radius-hero)" }}
        />
        <span className="type-meta-default" style={{ color: "var(--fx-text-tertiary)", textAlign: "center" }}>
          {t("channelHeroThisComputer", "This computer")}
        </span>
      </div>
    </div>
  );
}

export function RelayHero({ snapshot }: { snapshot: ChannelsSnapshot }) {
  return (
    <section
      data-testid="channel-relay-hero"
      style={{
        display: "flex",
        alignItems: "center",
        width: "100%",
        border: "1px solid var(--fx-line-default)",
        borderRadius: "var(--radius-relay-hero)",
        background: "linear-gradient(120deg, var(--fx-surface-raised) 0%, var(--fx-surface-hero-tint) 100%)",
        overflow: "hidden",
      }}
    >
      <Summary snapshot={snapshot} />
      <Relay snapshot={snapshot} />
    </section>
  );
}
