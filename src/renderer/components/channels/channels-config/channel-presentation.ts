import type { ChannelAccountView, ChannelStatus, ChannelsSnapshot } from "@shared/channel-types";
import type { BadgeTone } from "../../form-controls";
import { channelLabel, channelStatusLabel, type Translate } from "./channel-labels";

export interface AccountPresence {
  tone: BadgeTone;
  label: string;
  online: boolean;
  offline: boolean;
}

export function accountPresence(status: ChannelStatus | undefined, t: Translate): AccountPresence {
  const state = status?.state ?? "stopped";
  if (state === "running")
    return { tone: "success", label: t("channelOnline", "Online"), online: true, offline: false };
  if (state === "reconnecting" || state === "error") {
    return { tone: "warning", label: t("channelOffline", "Offline"), online: false, offline: true };
  }
  if (state === "starting") {
    return { tone: "running", label: channelStatusLabel(state, t), online: false, offline: false };
  }
  return { tone: "muted", label: channelStatusLabel(state, t), online: false, offline: false };
}

export function connectionMethodLabel(account: ChannelAccountView, t: Translate): string {
  const method =
    account.channel === "telegram"
      ? t("channelMethod_telegram", "Bot")
      : account.channel === "feishu"
        ? t("channelMethod_feishu", "Self-built app")
        : t("channelMethod_weixin", "QR login");
  return `${channelLabel(account.channel, t, account.domain)} · ${method}`;
}

export function conversationCount(snapshot: ChannelsSnapshot, accountId: string): number {
  return snapshot.bindings.filter((binding) => binding.accountId === accountId).length;
}

export function conversationsLabel(count: number, t: Translate): string {
  return `${count} ${t("conversations", "conversations")}`;
}

export function lastMessageLabel(at: number | undefined, now: number, t: Translate): string | null {
  if (at === undefined || !Number.isFinite(at)) return null;
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  if (minutes < 1) return t("channelLastMessage_now", "message just now");
  if (minutes < 60) {
    return t("channelLastMessage_minutes", "last message {count} min ago").replace("{count}", String(minutes));
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("channelLastMessage_hours", "last message {count} h ago").replace("{count}", String(hours));
  return t("channelLastMessage_days", "last message {count} d ago").replace("{count}", String(Math.floor(hours / 24)));
}

export function formatPairingCode(code: string): string {
  if (code.length < 4 || code.length % 2 !== 0) return code;
  const half = code.length / 2;
  return `${code.slice(0, half)} · ${code.slice(half)}`;
}

export function initialOf(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "?";
}
