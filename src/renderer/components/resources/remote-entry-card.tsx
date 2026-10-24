import type { ChannelId, ChannelsSnapshot } from "@shared/channel-types";
import { useI18n } from "@/i18n";
import { formatNumber } from "@/lib/locale-format";
import { Badge } from "../form-controls";
import { ChannelBrandMark } from "../channels/channel-brand-mark";
import { ChevronRightIcon, SmartphoneIcon } from "./overview-icons";
import { SectionHeader } from "./resource-sections";

const SUPPORTED_CHANNELS: ChannelId[] = ["weixin", "telegram", "feishu"];

function shownChannels(snapshot: ChannelsSnapshot): ChannelId[] {
  const configured = new Set(snapshot.accounts.map((account) => account.channel));
  return configured.size === 0 ? SUPPORTED_CHANNELS : SUPPORTED_CHANNELS.filter((id) => configured.has(id));
}

function offlineCount(snapshot: ChannelsSnapshot): number {
  return snapshot.accounts.filter(
    (account) =>
      account.enabled && !snapshot.statuses.some((status) => status.accountId === account.id && status.connected),
  ).length;
}

export function RemoteEntryCard({ snapshot, onOpen }: { snapshot: ChannelsSnapshot; onOpen: () => void }) {
  const { language, t } = useI18n();
  const connected = snapshot.bindings.length;
  const offline = offlineCount(snapshot);
  const title = t("channels", "Remote chat");

  return (
    <section aria-labelledby="resource-builtin-heading" className="flex w-full flex-col gap-[12px]">
      <SectionHeader id="resource-builtin-heading" title={t("builtInPlugins", "Built-in plugins")} count={1} />
      <button
        type="button"
        aria-label={title}
        onClick={onOpen}
        className="flex w-full min-w-0 cursor-pointer items-center gap-[16px] rounded-[var(--radius-resource-card)] border border-solid border-[var(--fx-line-default)] bg-[var(--fx-surface-raised)] p-[16px] text-left transition-colors duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)] hover:bg-[var(--fx-surface-raised-hover)] motion-reduce:transition-none"
      >
        <span
          aria-hidden="true"
          className="flex size-[40px] shrink-0 items-center justify-center rounded-[var(--radius-card)] border border-solid border-[var(--fx-line-default)] bg-[var(--fx-surface-card)] text-[var(--fx-text-secondary)]"
        >
          <SmartphoneIcon size={18} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <span className="flex w-full min-w-0 items-center gap-[8px]">
            <span className="type-body-large-medium text-[var(--fx-text-primary)]">{title}</span>
            {connected > 0 ? (
              <Badge tone="success">
                {t("remoteChatConnectedCount", "{count} conversations connected").replace(
                  "{count}",
                  formatNumber(connected, language),
                )}
              </Badge>
            ) : (
              <Badge tone="muted">{t("remoteChatNoConnections", "No conversations connected")}</Badge>
            )}
          </span>
          <span className="type-body-default text-[var(--fx-text-secondary)]">
            {t(
              "remoteChatEntryDescription",
              "Connect sessions to WeChat, Telegram, or Feishu and keep working from your phone when you're away",
            )}
          </span>
        </span>
        <span aria-hidden="true" className="flex shrink-0 items-center gap-[4px]">
          {shownChannels(snapshot).map((channel) => (
            <ChannelBrandMark key={channel} channel={channel} size={22} />
          ))}
        </span>
        {offline > 0 && (
          <span className="flex shrink-0 items-center gap-[6px]">
            <span aria-hidden="true" className="size-[6px] rounded-[3px] bg-[var(--fx-status-warning)]" />
            <span className="type-label-default whitespace-nowrap text-[var(--fx-status-warning-text)]">
              {t("remoteChatOfflineCount", "{count} offline").replace("{count}", formatNumber(offline, language))}
            </span>
          </span>
        )}
        <ChevronRightIcon size={15} className="text-[var(--fx-text-tertiary)]" />
      </button>
    </section>
  );
}
