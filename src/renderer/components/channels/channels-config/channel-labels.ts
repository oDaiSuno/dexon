import type {
  ChannelAccountConfig,
  ChannelActivity,
  ChannelRuntimeState,
  ChannelStatus,
  ChannelsSnapshot,
  FeishuDomain,
} from "@shared/channel-types";

export function statusFor(snapshot: ChannelsSnapshot, accountId: string): ChannelStatus | undefined {
  return snapshot.statuses.find((status) => status.accountId === accountId);
}

export function statusColor(status?: ChannelStatus): string {
  if (status?.state === "running") return "var(--fx-status-success)";
  if (status?.state === "starting" || status?.state === "reconnecting") return "var(--fx-status-warning)";
  if (status?.state === "error") return "var(--fx-status-danger)";
  return "var(--fx-text-tertiary)";
}

export type Translate = (key: string, fallback: string) => string;

export function channelStatusLabel(status: ChannelRuntimeState, t: Translate): string {
  switch (status) {
    case "starting":
      return t("channelStatus_starting", "starting");
    case "running":
      return t("channelStatus_running", "running");
    case "reconnecting":
      return t("channelStatus_reconnecting", "reconnecting");
    case "stopped":
      return t("channelStatus_stopped", "stopped");
    case "error":
      return t("channelStatus_error", "error");
  }
}

export function activityDirectionLabel(direction: ChannelActivity["direction"], t: Translate): string {
  switch (direction) {
    case "inbound":
      return t("activityDirection_inbound", "inbound");
    case "outbound":
      return t("activityDirection_outbound", "outbound");
    case "system":
      return t("activityDirection_system", "system");
  }
}

export function activityOutcomeLabel(outcome: ChannelActivity["outcome"], t: Translate): string {
  switch (outcome) {
    case "accepted":
      return t("activityOutcome_accepted", "accepted");
    case "ignored":
      return t("activityOutcome_ignored", "ignored");
    case "sent":
      return t("activityOutcome_sent", "sent");
    case "failed":
      return t("activityOutcome_failed", "failed");
  }
}

export function channelLabel(channel: ChannelAccountConfig["channel"], t: Translate, domain?: FeishuDomain): string {
  if (channel === "telegram") return "Telegram";
  if (channel === "feishu") {
    if (domain === "lark") return "Lark";
    if (domain === "feishu") return t("feishu", "Feishu");
    return t("feishuLark", "Feishu / Lark");
  }
  return t("weixin", "WeChat");
}

export function channelAccent(channel: ChannelAccountConfig["channel"]): string {
  if (channel === "telegram") return "#229ed9";
  if (channel === "feishu") return "#3370ff";
  return "#07c160";
}
